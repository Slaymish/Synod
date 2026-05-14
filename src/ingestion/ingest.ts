/* RawEntry → Entry pipeline: dedup hash + word-count, persist via Store. */

import type { Store } from "../storage/store";
import { contentHash } from "./dedup";
import type { Entry, RawEntry } from "./types";
import { nowIso } from "../util/time";

export async function rawToEntry(r: RawEntry): Promise<Entry> {
  const id = await contentHash(r.user_text);
  const wordCount = r.user_text.trim().split(/\s+/).filter(Boolean).length;
  return {
    id,
    written_at: r.written_at,
    ingested_at: nowIso(),
    source: r.source,
    user_text: r.user_text,
    rosebud_ai_text: r.rosebud_ai_text,
    word_count: wordCount,
    tags: r.tags,
  };
}

export async function ingest(store: Store, raws: RawEntry[]): Promise<{ added: number; duplicates: number }> {
  const entries: Entry[] = [];
  for (const r of raws) entries.push(await rawToEntry(r));
  return store.addEntries(entries);
}
