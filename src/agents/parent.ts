/* Parent orchestrator. Fans out one value agent per active value, then
 * compiles the reports into a DecisionPacket.
 *
 * Isolation contract: each agent receives only its own value definition and
 * the shared entry corpus. The parent never passes one agent's output to
 * another. Even when value agents run "in parallel" (Promise.all), the LLM
 * single-flight gate in `llm/index.ts` serialises generation if the backend
 * lane is single-track.
 */

import type { LlmFn } from "../llm";
import type { Entry } from "../ingestion/types";
import type { Store } from "../storage/store";
import type { PromptStore } from "../prompts";
import type { DecisionPacket, ValueAgentInput, ValueReport } from "./types";

import { compileReports } from "./compiler";
import { log } from "../util/log";
import { runValueAgent } from "./value-agent";

export interface RunOpts {
  agent: LlmFn;
  compiler: LlmFn;
  prompts: PromptStore;
  agentMaxCharsPerCall: number;
  /** Status reporter for UI updates between phases. Optional. */
  onProgress?: (phase: string, current: number, total: number, detail: string) => void;
}

export async function runBulletinCycle(
  store: Store,
  periodStart: string,
  periodEnd: string,
  opts: RunOpts,
): Promise<DecisionPacket> {
  const values = store.activeValues();
  if (!values.length) throw new Error("No confirmed values. Run value extraction first.");

  const entries: Entry[] = store.entriesInRange(periodStart, periodEnd);
  const entryDicts = entries.map((e) => ({
    id: e.id,
    written_at: e.written_at,
    user_text: e.user_text,
  }));

  log.info(
    `Running ${values.length} value agents over ${entries.length} entries (${periodStart} → ${periodEnd})`,
  );

  // Fan-out — Promise.all maintains parallelism for backends that support it;
  // single-GPU backends are serialised by the LLM semaphore in llm/index.ts.
  const reports: ValueReport[] = [];
  let done = 0;
  const tasks = values.map((v) =>
    (async () => {
      const input: ValueAgentInput = {
        value_id: v.id,
        value_name: v.name,
        value_definition: v.definition,
        period_start: periodStart,
        period_end: periodEnd,
        relevant_entries: entryDicts,
      };
      const report = await runValueAgent(input, opts.agent, opts.prompts, {
        maxCharsPerCall: opts.agentMaxCharsPerCall,
      });
      // Persist
      await store.saveReport({
        id: `${v.id}_${periodEnd}`,
        value_id: v.id,
        period_start: periodStart,
        period_end: periodEnd,
        report,
        generated_at: new Date().toISOString(),
        model_used: "agent",
      });
      done++;
      opts.onProgress?.("agents", done, values.length, `Finished agent: ${v.name}`);
      return report;
    })(),
  );
  for (const r of await Promise.all(tasks)) reports.push(r);

  // Compile
  opts.onProgress?.("compiling", 0, 1, "Validating reports + finding tensions");
  const packet = await compileReports(reports, periodStart, periodEnd, opts.agent, opts.compiler, opts.prompts);
  await store.savePacket({
    id: packet.packet_id,
    period_start: periodStart,
    period_end: periodEnd,
    packet,
    delivered_at: null,
  });
  opts.onProgress?.("compiling", 1, 1, "Compiler finished");
  return packet;
}
