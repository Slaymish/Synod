/* Vault file writers. Deliberately minimal — only informative information,
 * no decorative HTML widgets, no progress bars rendered with inline styles.
 *
 * Layout:
 *   <rootFolder>/
 *     Bulletins/<YYYY-MM-DD>.md          ← one bulletin per run
 *     Values/<value-slug>.md              ← one short doc per active value
 *     Entries/<YYYY-MM-DD>-<id8>.md       ← optional, only if writeEntryFiles
 */

import { App, normalizePath, TFile, TFolder } from "obsidian";

import type { DecisionPacket } from "../agents/types";
import type { Entry } from "../ingestion/types";
import type { Value } from "../storage/types";
import { renderBulletin } from "./bulletin";
import { shortDate } from "../util/time";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const norm = normalizePath(path);
  if (app.vault.getAbstractFileByPath(norm) instanceof TFolder) return;
  try {
    await app.vault.createFolder(norm);
  } catch {
    /* race or already-exists */
  }
}

async function writeFile(app: App, path: string, body: string, overwrite: boolean): Promise<void> {
  const norm = normalizePath(path);
  const existing = app.vault.getAbstractFileByPath(norm);
  if (existing instanceof TFile) {
    // `process` modifies atomically, avoiding races with other plugins
    // editing the same file (per Obsidian plugin guidelines).
    if (overwrite) await app.vault.process(existing, () => body);
    return;
  }
  await app.vault.create(norm, body);
}

export async function writeBulletin(app: App, root: string, packet: DecisionPacket): Promise<string> {
  await ensureFolder(app, `${root}/Bulletins`);
  const date = shortDate(packet.period_end);
  const path = `${root}/Bulletins/${date}.md`;
  await writeFile(app, path, renderBulletin(packet), /* overwrite */ true);
  return path;
}

export async function writeValueFile(app: App, root: string, v: Value, score: number | null): Promise<string> {
  await ensureFolder(app, `${root}/Values`);
  const path = `${root}/Values/${slug(v.name)}.md`;
  const meta: string[] = ["---", `title: "${v.name.replace(/"/g, '\\"')}"`, "type: synod-value"];
  if (typeof score === "number") meta.push(`score: ${score.toFixed(2)}`);
  if (v.schwartz_anchor) meta.push(`schwartz_anchor: ${v.schwartz_anchor}`);
  if (v.confirmed_at) meta.push(`confirmed_at: ${shortDate(v.confirmed_at)}`);
  meta.push(`active: ${v.active}`, `personalised: ${v.definition_personalised}`, "tags: [synod/value]", "---");

  const body = [
    ...meta,
    "",
    `# ${v.name}`,
    "",
    v.definition,
  ];
  if (!v.definition_personalised) {
    body.push("", "> Definition is the academic Schwartz boilerplate. Rewrite this in your own words for sharper agent reasoning.");
  }
  await writeFile(app, path, body.join("\n"), /* overwrite */ true);
  return path;
}

const TITLE_LINE_RE = /^\*\*(.+?)\*\*\s*\n/;

export async function writeEntryFile(app: App, root: string, e: Entry): Promise<string | null> {
  await ensureFolder(app, `${root}/Entries`);
  const date = shortDate(e.written_at);
  const path = `${root}/Entries/${date}-${e.id.slice(0, 8)}.md`;
  if (app.vault.getAbstractFileByPath(normalizePath(path))) return null;

  const m = TITLE_LINE_RE.exec(e.user_text);
  const title = m ? m[1].trim() : new Date(e.written_at).toLocaleDateString();
  const body = m ? e.user_text.slice(m[0].length).trim() : e.user_text;

  const meta = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `date: ${date}`,
    `source: ${e.source}`,
    `word_count: ${e.word_count}`,
    "tags: [synod/entry]",
    "---",
    "",
    `# ${title}`,
    "",
    body,
  ];
  await writeFile(app, path, meta.join("\n"), /* overwrite */ false);
  return path;
}
