/* Schwartz-anchored value extraction.
 *
 * Char-budgeted progressive batching: the extractor packs as many full
 * entries as fit into one LLM call, then spills into additional calls. No
 * entry is silently truncated. Per-batch results are then averaged.
 */

import type { Entry } from "../ingestion/types";
import type { LlmFn } from "../llm";
import { fill, PromptStore } from "../prompts";
import { packEntries } from "../util/text-packing";
import { log, uuid } from "../util/log";
import {
  SCHWARTZ_DEFINITIONS,
  SCHWARTZ_VALUES,
  schwartzDefinitionsBlock,
  SchwartzValue,
} from "./schwartz";
import { parseLooseJson } from "../agents/json";
import { shortDate } from "../util/time";

const PROMPT_OVERHEAD_CHARS = 2500;

export interface CandidateValue {
  id: string;
  name: string;
  definition: string;
  schwartz_anchor: string | null;
  score: number;
  evidence: string[];
}

interface BatchResult {
  schwartz_scores: Partial<Record<SchwartzValue, number>>;
  schwartz_evidence: Partial<Record<SchwartzValue, string[]>>;
  custom_values: { name: string; definition: string; score: number; evidence: string[] }[];
}

async function extractBatch(
  llm: LlmFn,
  prompts: PromptStore,
  blocks: string[],
): Promise<BatchResult | null> {
  const tpl = await prompts.load("schwartz_extractor");
  const filled = fill(tpl, {
    definitions: schwartzDefinitionsBlock(),
    entries: blocks.join("\n\n---\n\n"),
  });
  try {
    const raw = await llm("", filled, { expectJson: true });
    return parseLooseJson(raw) as BatchResult;
  } catch (e) {
    log.warn(`Extraction batch failed (${blocks.length} blocks): ${(e as Error).message}`);
    return null;
  }
}

function aggregate(parts: BatchResult[]): BatchResult {
  const scores: Record<string, number[]> = {};
  const evidence: Record<string, string[]> = {};
  const customMap = new Map<string, { name: string; definition: string; scores: number[]; evidence: string[] }>();

  for (const sv of SCHWARTZ_VALUES) {
    scores[sv] = [];
    evidence[sv] = [];
  }

  for (const part of parts) {
    for (const sv of SCHWARTZ_VALUES) {
      const s = part.schwartz_scores?.[sv];
      scores[sv].push(typeof s === "number" ? s : 0);
      const ev = part.schwartz_evidence?.[sv] ?? [];
      for (const q of ev) {
        if (!evidence[sv].includes(q)) evidence[sv].push(q);
      }
    }
    for (const cv of part.custom_values ?? []) {
      const name = (cv.name ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = customMap.get(key);
      if (!existing) {
        customMap.set(key, {
          name,
          definition: cv.definition ?? "",
          scores: [cv.score ?? 0],
          evidence: cv.evidence ?? [],
        });
      } else {
        existing.scores.push(cv.score ?? 0);
        for (const q of cv.evidence ?? []) {
          if (!existing.evidence.includes(q)) existing.evidence.push(q);
        }
      }
    }
  }

  const avgScores: Partial<Record<SchwartzValue, number>> = {};
  for (const sv of SCHWARTZ_VALUES) {
    const arr = scores[sv];
    avgScores[sv] = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  return {
    schwartz_scores: avgScores,
    schwartz_evidence: evidence,
    custom_values: Array.from(customMap.values()).map((c) => ({
      name: c.name,
      definition: c.definition,
      score: c.scores.reduce((a, b) => a + b, 0) / c.scores.length,
      evidence: c.evidence,
    })),
  };
}

export interface ExtractOpts {
  /** Max entries to read (most-recent first). */
  window: number;
  /** LLM call char budget. */
  maxCharsPerCall: number;
}

export async function extractCandidateValues(
  entries: Entry[],
  llm: LlmFn,
  prompts: PromptStore,
  opts: ExtractOpts,
): Promise<CandidateValue[]> {
  const recent = entries
    .slice()
    .sort((a, b) => b.written_at.localeCompare(a.written_at))
    .slice(0, opts.window);
  if (!recent.length) return [];

  const budget = Math.max(opts.maxCharsPerCall - PROMPT_OVERHEAD_CHARS, 4000);
  const batches = packEntries(
    recent.map((e) => ({ date: shortDate(e.written_at), body: e.user_text })),
    budget,
  );
  log.info(
    `Extracting values from ${recent.length} entries → ${batches.length} LLM call(s) (budget=${budget})`,
  );

  const parts: BatchResult[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const total = batch.reduce((a, b) => a + b.length, 0);
    log.info(`Processing extractor batch ${i + 1}/${batches.length} (${batch.length} blocks, ${total} chars)`);
    const result = await extractBatch(llm, prompts, batch);
    if (result) parts.push(result);
  }
  if (!parts.length) {
    log.error("All extraction batches failed");
    return [];
  }

  const data = aggregate(parts);
  const out: CandidateValue[] = [];
  for (const sv of SCHWARTZ_VALUES) {
    const score = data.schwartz_scores[sv] ?? 0;
    const ev = data.schwartz_evidence[sv] ?? [];
    if (score >= 0.55 && ev.length) {
      out.push({
        id: uuid(),
        name: sv.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        definition: SCHWARTZ_DEFINITIONS[sv],
        schwartz_anchor: sv,
        score,
        evidence: ev,
      });
    }
  }
  for (const cv of data.custom_values) {
    if (cv.score >= 0.55 && cv.evidence.length) {
      out.push({
        id: uuid(),
        name: cv.name,
        definition: cv.definition,
        schwartz_anchor: null,
        score: cv.score,
        evidence: cv.evidence,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
