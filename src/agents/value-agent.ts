/* Single value-agent. Isolation contract:
 *
 *   Input is exactly ValueAgentInput — this value's (id, name, definition)
 *   and the shared entry corpus. The agent never sees other values, other
 *   agents' outputs, or even their names. There is no shared state object;
 *   tests at the type level enforce that this module never imports from
 *   `compiler.ts`.
 *
 * Char-budgeted progressive batching: pack as many full entries as fit into
 * one LLM call, spill into additional calls, then merge results.
 */

import type { LlmFn } from "../llm";
import type { Observation, Recommendation, ValueAgentInput, ValueReport } from "./types";
import { fill, PromptStore } from "../prompts";
import { packEntries } from "../util/text-packing";
import { log } from "../util/log";
import { shortDate } from "../util/time";
import { parseLooseJson } from "./json";

const PROMPT_OVERHEAD_CHARS = 2500;

interface BatchPart {
  observations?: Observation[];
  recommendations?: Recommendation[];
  open_questions?: string[];
  self_score?: number;
}

function aggregate(parts: BatchPart[]): {
  observations: Observation[];
  recommendations: Recommendation[];
  open_questions: string[];
  self_score: number;
} {
  const obs: Observation[] = [];
  const seenClaims = new Set<string>();
  const recs: Recommendation[] = [];
  const seenActions = new Set<string>();
  const qs: string[] = [];
  const seenQs = new Set<string>();
  const scores: number[] = [];

  for (const p of parts) {
    for (const o of p.observations ?? []) {
      const key = (o.claim ?? "").trim().toLowerCase();
      if (key && !seenClaims.has(key)) {
        seenClaims.add(key);
        obs.push(o);
      }
    }
    for (const r of p.recommendations ?? []) {
      const key = (r.action ?? "").trim().toLowerCase();
      if (key && !seenActions.has(key)) {
        seenActions.add(key);
        recs.push(r);
      }
    }
    for (const q of p.open_questions ?? []) {
      const key = q.trim().toLowerCase();
      if (key && !seenQs.has(key)) {
        seenQs.add(key);
        qs.push(q);
      }
    }
    if (typeof p.self_score === "number") scores.push(p.self_score);
  }
  return {
    observations: obs,
    recommendations: recs,
    open_questions: qs,
    self_score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.5,
  };
}

export interface ValueAgentOpts {
  maxCharsPerCall: number;
}

export async function runValueAgent(
  input: ValueAgentInput,
  llm: LlmFn,
  prompts: PromptStore,
  opts: ValueAgentOpts,
): Promise<ValueReport> {
  const tpl = await prompts.load("value_agent");
  const system = fill(tpl, {
    value_name: input.value_name,
    value_definition: input.value_definition,
  });

  const budget = Math.max(opts.maxCharsPerCall - PROMPT_OVERHEAD_CHARS, 4000);
  const pairs = input.relevant_entries.map((e) => ({
    date: shortDate(e.written_at),
    body: e.user_text,
  }));
  const batches = pairs.length ? packEntries(pairs, budget) : [[]];

  log.info(
    `Value agent '${input.value_name}' reasoning over ${pairs.length} entries → ${batches.length} batch(es)`,
  );

  const parts: BatchPart[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (!batch.length) continue;
    const note = batches.length === 1
      ? ""
      : `\n\n(This is batch ${i + 1}/${batches.length} of the period's entries. ` +
        `Reason about what you see here; results from all batches will be merged.)`;
    const user = `Period: ${input.period_start} to ${input.period_end}${note}\n\n` +
      `Journal entries:\n${batch.join("\n\n---\n\n")}`;
    try {
      const raw = await llm(system, user, { expectJson: true });
      parts.push(parseLooseJson(raw) as BatchPart);
    } catch (e) {
      log.warn(`Value-agent batch ${i + 1}/${batches.length} failed: ${(e as Error).message}`);
    }
  }

  const merged = parts.length
    ? aggregate(parts)
    : { observations: [], recommendations: [], open_questions: [], self_score: 0.5 };

  return {
    value_id: input.value_id,
    value_name: input.value_name,
    period_start: input.period_start,
    period_end: input.period_end,
    observations: merged.observations,
    recommendations: merged.recommendations,
    open_questions: merged.open_questions,
    self_score: merged.self_score,
  };
}
