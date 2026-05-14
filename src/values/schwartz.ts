/* Schwartz Theory of Basic Human Values — the 10 dimensions and definitions
 * used by the value extractor. Definitions are intentionally lifted verbatim
 * from the academic source; the user is expected to *personalise* them once
 * a value moves from candidate to confirmed. */

export const SCHWARTZ_VALUES = [
  "self-direction",
  "stimulation",
  "hedonism",
  "achievement",
  "power",
  "security",
  "conformity",
  "tradition",
  "benevolence",
  "universalism",
] as const;

export type SchwartzValue = (typeof SCHWARTZ_VALUES)[number];

export const SCHWARTZ_DEFINITIONS: Record<SchwartzValue, string> = {
  "self-direction": "Independent thought and action; choosing, creating, exploring.",
  "stimulation": "Excitement, novelty, and challenge in life.",
  "hedonism": "Pleasure and sensuous gratification for oneself.",
  "achievement": "Personal success through demonstrating competence according to social standards.",
  "power": "Social status and prestige, control or dominance over people and resources.",
  "security": "Safety, harmony, and stability of society, relationships, and self.",
  "conformity": "Restraint of actions, inclinations, and impulses likely to upset or harm others.",
  "tradition":
    "Respect, commitment, and acceptance of the customs and ideas that traditional culture or religion provides.",
  "benevolence":
    "Preserving and enhancing the welfare of those with whom one is in frequent personal contact.",
  "universalism":
    "Understanding, appreciation, tolerance, and protection for the welfare of all people and nature.",
};

export function schwartzDefinitionsBlock(): string {
  return SCHWARTZ_VALUES.map((v) => `- ${v}: ${SCHWARTZ_DEFINITIONS[v]}`).join("\n");
}
