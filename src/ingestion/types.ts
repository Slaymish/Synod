/* Raw + persisted entry types. */

export interface RawEntry {
  written_at: string;             // ISO datetime
  user_text: string;              // canonical user-authored text
  rosebud_ai_text?: string;       // optional AI/assistant turns or tag block
  tags?: string[];
  raw_md?: string;                // original markdown block
  source: "rosebud" | "obsidian-folder" | "obsidian-journal" | "manual";
}

export interface Entry {
  id: string;                     // sha256(normalised user_text)
  written_at: string;             // ISO
  ingested_at: string;            // ISO
  source: RawEntry["source"];
  user_text: string;
  rosebud_ai_text?: string;
  word_count: number;
  tags?: string[];
}
