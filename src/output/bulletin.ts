/* Render a DecisionPacket as Obsidian-friendly markdown. Section order is
 * deliberate: lead with what the user has not resolved, follow with where
 * they fell short, then surface what is working, then per-value verdicts.
 */

import type { DecisionPacket, Recommendation, Tension } from "../agents/types";
import { shortDate } from "../util/time";

function renderRecommendation(r: Recommendation): string {
  const lines = [`- **${r.action ?? "(no action)"}**`];
  if (r.concrete_next_step) lines.push(`  - Do: ${r.concrete_next_step}`);
  if (r.success_check) lines.push(`  - Check: ${r.success_check}`);
  if (r.rationale) lines.push(`  - Why: *${r.rationale}*`);
  if (r.urgency) lines.push(`  - Urgency: ${r.urgency}`);
  return lines.join("\n");
}

function severityLabel(s: number): string {
  if (s >= 0.85) return "critical";
  if (s >= 0.65) return "high";
  if (s >= 0.4) return "medium";
  return "low";
}

const NEGATIVE_MARKERS = [
  "didn't", "did not", "failed", "fell short", "skipped", "avoided",
  "neglected", "missed", "broke", "betrayed", "ignored", "no evidence",
  "absent", "lacking", "gave up", "abandoned", "couldn't", "could not",
  "struggled", "instead of", "rather than",
];

function isNegativeObservation(claim: string): boolean {
  const t = claim.toLowerCase();
  return NEGATIVE_MARKERS.some((m) => t.includes(m));
}

function tensionDetail(t: Tension): string {
  const sev = severityLabel(t.severity);
  const a = t.positions.a;
  const b = t.positions.b;
  const lines = [
    `**Decision:** ${t.decision_question}`,
    "",
    `- **A — ${t.value_a_name}:** ${t.option_a}`,
  ];
  if (a.evidence?.length) {
    lines.push("  > " + a.evidence.slice(0, 2).map((q) => `"${q}"`).join(" | "));
  }
  lines.push(`- **B — ${t.value_b_name}:** ${t.option_b}`);
  if (b.evidence?.length) {
    lines.push("  > " + b.evidence.slice(0, 2).map((q) => `"${q}"`).join(" | "));
  }
  lines.push(
    "",
    `**Stakes:** ${t.stakes}`,
    `**Would dissolve if:** ${t.would_resolve}`,
    `Decision required: ${t.decision_required ? "Yes" : "No"}  ·  Severity: ${sev}`,
    `\`${t.tension_id}\``,
  );
  return lines.join("\n");
}

export function renderBulletin(packet: DecisionPacket): string {
  const periodEnd = shortDate(packet.period_end);
  const sections: string[] = [`# Synod — ${periodEnd}`, ""];

  // 1. Unresolved tensions
  const tensions = packet.tensions_for_user.slice().sort((a, b) => b.severity - a.severity);
  sections.push("## Conflicts you haven't resolved", "");
  if (tensions.length) {
    tensions.forEach((t, i) => {
      sections.push(`### ${i + 1}. ${t.value_a_name} vs ${t.value_b_name}`);
      sections.push(tensionDetail(t));
      sections.push("");
    });
  } else {
    sections.push("*No active tensions this period.*", "");
  }

  // 2. Where you actually fell short
  const negObs = (packet.consolidated_observations ?? []).filter(
    (o) => (o.confidence ?? 1) >= 0.5 && isNegativeObservation(o.claim ?? ""),
  );
  if (negObs.length) {
    sections.push("## Where you actually fell short", "");
    for (const o of negObs) sections.push(`- ${o.claim}`);
    sections.push("");
  }

  // 3. What's working
  const unanimous = packet.unanimous_recommendations ?? [];
  const posObs = (packet.consolidated_observations ?? []).filter(
    (o) => (o.confidence ?? 1) >= 0.5 && !isNegativeObservation(o.claim ?? ""),
  );
  if (unanimous.length || posObs.length) {
    sections.push("## What's working", "");
    for (const r of unanimous) sections.push(renderRecommendation(r));
    for (const o of posObs) sections.push(`- ${o.claim}`);
    sections.push("");
  }

  // 4. Each value's verdict
  if (packet.minority_reports?.length) {
    sections.push("## Each value's verdict", "");
    for (const m of packet.minority_reports) {
      sections.push(`### ${m.value_name}`);
      if (m.self_score !== null && m.self_score !== undefined) {
        sections.push(`*Self-score: ${m.self_score.toFixed(2)}*`);
      }
      for (const r of m.recommendations) sections.push(renderRecommendation(r));
      sections.push("");
    }
  }

  return sections.join("\n");
}
