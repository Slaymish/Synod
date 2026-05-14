/* High-level driver that ties Store + LLM + agents + output together. The
 * Obsidian plugin only ever calls these functions; nothing else needs to
 * understand the pipeline.
 */

import type { App } from "obsidian";

import type { Store } from "./storage/store";
import type { PromptStore } from "./prompts";
import { extractCandidateValues, CandidateValue } from "./values/extractor";
import { getLlm } from "./llm";
import { isoMinusDays, nowIso } from "./util/time";
import { runBulletinCycle } from "./agents/parent";
import { writeBulletin, writeEntryFile, writeValueFile } from "./output/files";
import { log } from "./util/log";
import type { DecisionPacket } from "./agents/types";

interface PhaseHandlers {
  onPhase: (phase: string, detail: string) => void;
  onProgress: (current: number, total: number, detail: string) => void;
}

function phasesFor(store: Store): PhaseHandlers {
  return {
    onPhase: (phase, detail) =>
      void store.setStatus({
        phase: phase as never,
        detail,
        progress: null,
        error: null,
        finishedAt: null,
      }),
    onProgress: (current, total, detail) =>
      void store.setStatus({ progress: { current, total }, detail }),
  };
}

/** Discover candidate values from recent entries. The user picks which to
 *  confirm via the settings tab / value-management modal. */
export async function discoverValues(store: Store, prompts: PromptStore): Promise<CandidateValue[]> {
  const s = store.settings;
  const llm = getLlm(s, "agent");
  const ph = phasesFor(store);
  await store.setStatus({ phase: "extracting", detail: "Extracting candidate values…", startedAt: nowIso() });
  try {
    const out = await extractCandidateValues(store.entries, llm, prompts, {
      window: 75,
      maxCharsPerCall: s.budgets.extractorMaxCharsPerCall,
    });
    ph.onPhase("done", `Extracted ${out.length} candidate value${out.length === 1 ? "" : "s"}.`);
    await store.setStatus({ finishedAt: nowIso() });
    return out;
  } catch (e) {
    log.error(`discoverValues failed: ${(e as Error).message}`);
    await store.setStatus({ phase: "error", detail: (e as Error).message, error: (e as Error).message, finishedAt: nowIso() });
    throw e;
  }
}

export interface RunResult {
  packet: DecisionPacket;
  bulletinPath: string;
}

/** Run the full bulletin cycle: agents fan-out → compile → write to vault. */
export async function runFullCycle(
  app: App,
  store: Store,
  prompts: PromptStore,
  periodDays: number,
): Promise<RunResult> {
  const s = store.settings;
  const periodEnd = nowIso();
  const periodStart = isoMinusDays(periodDays, new Date(periodEnd));
  const agent = getLlm(s, "agent");
  const compiler = getLlm(s, "compiler");

  const ph = phasesFor(store);
  await store.setStatus({
    phase: "agents",
    detail: "Running value agents…",
    startedAt: nowIso(),
    finishedAt: null,
    progress: { current: 0, total: store.activeValues().length },
    error: null,
  });

  try {
    const packet = await runBulletinCycle(store, periodStart, periodEnd, {
      agent,
      compiler,
      prompts,
      agentMaxCharsPerCall: s.budgets.valueAgentMaxCharsPerCall,
      onProgress: (phase, current, total, detail) =>
        void store.setStatus({
          phase: phase as never,
          detail,
          progress: { current, total },
        }),
    });

    ph.onPhase("writing", "Writing bulletin and value files to vault…");
    const bulletinPath = await writeBulletin(app, s.output.rootFolder, packet);
    if (s.output.writeValueFiles) {
      for (const v of store.activeValues()) {
        const score = packet.minority_reports.find((m) => m.value_name === v.name)?.self_score ?? null;
        await writeValueFile(app, s.output.rootFolder, v, score);
      }
    }
    if (s.output.writeEntryFiles) {
      for (const e of store.entriesInRange(periodStart, periodEnd)) {
        await writeEntryFile(app, s.output.rootFolder, e);
      }
    }

    await store.markRun("bulletin");
    await store.setStatus({
      phase: "done",
      detail: `Wrote bulletin to ${bulletinPath}`,
      progress: null,
      finishedAt: nowIso(),
    });
    return { packet, bulletinPath };
  } catch (e) {
    log.error(`runFullCycle failed: ${(e as Error).message}`);
    await store.setStatus({
      phase: "error",
      detail: (e as Error).message,
      error: (e as Error).message,
      finishedAt: nowIso(),
    });
    throw e;
  }
}
