/* Typed schemas for the Synod pipeline.
 *
 * Isolation rule: ValueAgentInput must contain ONLY this value's own
 * (id, name, definition) plus the shared entry corpus. The parent never
 * passes one agent's output to another. Tests should enforce this at the
 * type level — see tests/isolation.test.ts.
 */

export interface Observation {
  claim: string;
  evidence_entry_ids: string[];
  confidence: number; // 0..1
}

export interface Recommendation {
  action: string;
  rationale?: string;
  urgency?: "low" | "med" | "high";
  concrete_next_step?: string;
  success_check?: string;
}

export interface ValueReport {
  value_id: string;
  value_name: string;
  period_start: string;
  period_end: string;
  observations: Observation[];
  recommendations: Recommendation[];
  open_questions: string[];
  self_score: number;
}

export interface TensionPosition {
  claim: string;
  evidence: string[];
}

export interface Tension {
  tension_id: string;
  value_a_id: string;
  value_b_id: string;
  value_a_name: string;
  value_b_name: string;
  positions: { a: TensionPosition; b: TensionPosition };
  decision_question: string;
  option_a: string;
  option_b: string;
  stakes: string;
  would_resolve: string;
  decision_required: boolean;
  severity: number;
}

export interface MinorityReport {
  value_name: string;
  recommendations: Recommendation[];
  self_score: number | null;
}

export interface OpenQuestionGroup {
  value_name: string;
  questions: string[];
}

export interface DecisionPacket {
  packet_id: string;
  period_start: string;
  period_end: string;
  summary: string;
  consolidated_observations: Observation[];
  unanimous_recommendations: Recommendation[];
  tensions_for_user: Tension[];
  minority_reports: MinorityReport[];
  /** Per-value open questions surfaced by the value agents. May be absent on
   *  packets persisted before v0.2.0. */
  open_questions?: OpenQuestionGroup[];
  reopen_conditions: string[];
}

/** What the parent sends to a value agent. No other-value data permitted. */
export interface ValueAgentInput {
  value_id: string;
  value_name: string;
  value_definition: string;
  period_start: string;
  period_end: string;
  relevant_entries: { id: string; written_at: string; user_text: string }[];
}
