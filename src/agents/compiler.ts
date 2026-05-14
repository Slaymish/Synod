/* Three-pass Compiler:
 *
 *   Pass 0 — report validator (compiler model). Gate each ValueReport on a
 *            minimum evidentiary bar before it can pollute the tension pass.
 *   Pass 1 — tension finder (agent model). Over-detects candidate tensions.
 *   Pass 2 — tension validator (compiler model). Filters to true mutual
 *            exclusivity, rates severity 0–1.
 *
 * Principle of Non-Compromise (Minsky §3.2): the Compiler surfaces real
 * choices, never adjudicates them. The validator prompt explicitly forbids
 * suggesting compromises.
 */

import type { LlmFn } from "../llm";
import type {
  DecisionPacket,
  Observation,
  Recommendation,
  Tension,
  ValueReport,
} from "./types";
import type { PromptStore } from "../prompts";
import { log, uuid } from "../util/log";
import { parseLooseJson } from "./json";

interface ValidationRecord {
  value_id: string;
  value_name: string;
  passed: boolean;
  issues: string[];
  adjusted_score: number | null;
}

async function runReportValidator(
  reports: ValueReport[],
  compiler: LlmFn,
  prompts: PromptStore,
): Promise<ValidationRecord[]> {
  if (!reports.length) return [];
  const system = await prompts.load("compiler_report_validator");
  const payload = reports.map((r) => ({
    value_id: r.value_id,
    value_name: r.value_name,
    observations: r.observations,
    recommendations: r.recommendations,
    self_score: r.self_score,
  }));
  try {
    const raw = await compiler(system, `ValueReports:\n${JSON.stringify(payload, null, 2)}`, {
      expectJson: true,
    });
    const data = parseLooseJson(raw) as { validations?: ValidationRecord[] };
    return data.validations ?? [];
  } catch (e) {
    log.warn(`Report validator failed: ${(e as Error).message} — passing all reports`);
    return reports.map((r) => ({
      value_id: r.value_id,
      value_name: r.value_name,
      passed: true,
      issues: [],
      adjusted_score: null,
    }));
  }
}

function applyValidations(
  reports: ValueReport[],
  validations: ValidationRecord[],
): { kept: ValueReport[]; records: ValidationRecord[] } {
  const byId = new Map(validations.map((v) => [v.value_id, v]));
  const kept: ValueReport[] = [];
  for (const r of reports) {
    const v = byId.get(r.value_id);
    if (!v) {
      kept.push(r);
      continue;
    }
    if (!v.passed) {
      log.warn(`Report for value '${r.value_name}' failed validation: ${JSON.stringify(v.issues)}`);
      continue;
    }
    if (typeof v.adjusted_score === "number") {
      kept.push({ ...r, self_score: v.adjusted_score });
    } else {
      kept.push(r);
    }
  }
  return { kept, records: validations };
}

interface FinderResult {
  candidate_tensions?: RawCandidateTension[];
  unanimous_recommendations?: Recommendation[];
  consolidated_observations?: Observation[];
}

interface RawCandidateTension {
  value_a_id: string;
  value_b_id: string;
  value_a_name: string;
  value_b_name: string;
  position_a: { claim: string; evidence: string[] };
  position_b: { claim: string; evidence: string[] };
  decision_question?: string;
  option_a?: string;
  option_b?: string;
  stakes?: string;
  would_resolve?: string;
  decision_required?: boolean;
}

async function runFinder(
  reports: ValueReport[],
  agent: LlmFn,
  prompts: PromptStore,
): Promise<FinderResult> {
  const system = await prompts.load("compiler_finder");
  const raw = await agent(system, `ValueReports:\n${JSON.stringify(reports, null, 2)}`, {
    expectJson: true,
  });
  return parseLooseJson(raw) as FinderResult;
}

interface ValidatedTension {
  value_a_id: string;
  value_b_id: string;
  value_a_name: string;
  value_b_name: string;
  positions: { a: { claim: string; evidence: string[] }; b: { claim: string; evidence: string[] } };
  decision_question?: string;
  option_a?: string;
  option_b?: string;
  stakes: string;
  would_resolve: string;
  decision_required: boolean;
  severity: number;
  is_real: boolean;
}

async function runTensionValidator(
  candidates: RawCandidateTension[],
  compiler: LlmFn,
  prompts: PromptStore,
): Promise<ValidatedTension[]> {
  if (!candidates.length) return [];
  const system = await prompts.load("compiler_validator");
  const raw = await compiler(system, `Candidate tensions:\n${JSON.stringify(candidates, null, 2)}`, {
    expectJson: true,
  });
  const data = parseLooseJson(raw) as { validated_tensions?: ValidatedTension[] };
  return (data.validated_tensions ?? []).filter((t) => t.is_real);
}

function dedupObservations(obs: Observation[]): Observation[] {
  const seen = new Set<string>();
  const out: Observation[] = [];
  for (const o of obs) {
    const ids = new Set(o.evidence_entry_ids ?? []);
    let overlap = false;
    for (const id of ids) {
      if (seen.has(id)) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    for (const id of ids) seen.add(id);
    out.push(o);
  }
  return out;
}

export async function compileReports(
  reports: ValueReport[],
  periodStart: string,
  periodEnd: string,
  agent: LlmFn,
  compiler: LlmFn,
  prompts: PromptStore,
): Promise<DecisionPacket> {
  // Pass 0
  const validations = await runReportValidator(reports, compiler, prompts);
  const { kept, records } = applyValidations(reports, validations);

  // Pass 1 + 2
  const finderResult = await runFinder(kept, agent, prompts);
  const validated = await runTensionValidator(finderResult.candidate_tensions ?? [], compiler, prompts);

  const tensions: Tension[] = validated.map((t) => {
    const aName = t.value_a_name;
    const bName = t.value_b_name;
    const decisionQ = t.decision_question || `Which side wins this week — ${aName} or ${bName}?`;
    const optA = t.option_a || `Side with ${aName}: ${t.positions.a.claim}`;
    const optB = t.option_b || `Side with ${bName}: ${t.positions.b.claim}`;
    return {
      tension_id: uuid(),
      value_a_id: t.value_a_id,
      value_b_id: t.value_b_id,
      value_a_name: aName,
      value_b_name: bName,
      positions: t.positions,
      decision_question: decisionQ,
      option_a: optA,
      option_b: optB,
      stakes: t.stakes,
      would_resolve: t.would_resolve,
      decision_required: t.decision_required,
      severity: Number(t.severity),
    };
  });

  const allObservations = kept.flatMap((r) => r.observations ?? []);
  const unanimous = (finderResult.unanimous_recommendations ?? []).filter((r) => r.action);
  const unanimousActions = new Set(unanimous.map((r) => r.action));
  const minorityReports = kept
    .map((r) => {
      const unique = (r.recommendations ?? []).filter(
        (rec) => rec.action && !unanimousActions.has(rec.action),
      );
      if (!unique.length) return null;
      return {
        value_name: r.value_name,
        recommendations: unique,
        self_score: r.self_score ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const nFailed = records.filter((v) => !v.passed).length;
  const summary = `Compiled ${kept.length} value reports (${nFailed} dropped at validation). ${tensions.length} tensions surfaced.`;

  return {
    packet_id: uuid(),
    period_start: periodStart,
    period_end: periodEnd,
    summary,
    consolidated_observations: dedupObservations(allObservations),
    unanimous_recommendations: unanimous,
    tensions_for_user: tensions,
    minority_reports: minorityReports,
    reopen_conditions: tensions.map((t) => t.would_resolve),
  };
}
