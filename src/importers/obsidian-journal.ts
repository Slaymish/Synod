/* Obsidian Journals importer.
 *
 * The Obsidian Journals (and built-in Daily Notes) convention is one note
 * per day, named per a configurable date format (default `YYYY-MM-DD`). We
 * use the filename to derive `written_at` — frontmatter is only consulted
 * if the filename doesn't match the format.
 *
 * For users whose journal notes contain multiple section headers
 * (`## Morning`, `## Evening`, etc.), each section becomes its own entry
 * timestamped to the same day so per-section nuance survives the agent
 * pipeline. A note with no section headers produces a single entry.
 */

import { App, normalizePath, TFile, TFolder } from "obsidian";

import type { RawEntry } from "../ingestion/types";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function stripFrontmatter(text: string): string {
  const m = FRONTMATTER_RE.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** Convert an Obsidian-style date format (YYYY-MM-DD, DD-MM-YYYY, etc.) into
 *  a regex with named groups. Only the tokens we care about are supported. */
function dateFormatToRegex(fmt: string): RegExp {
  // Escape literal regex chars except for tokens we substitute below.
  let pattern = fmt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  pattern = pattern
    .replace(/YYYY/g, "(?<y>\\d{4})")
    .replace(/MM/g, "(?<m>\\d{2})")
    .replace(/DD/g, "(?<d>\\d{2})");
  return new RegExp(`^${pattern}$`);
}

function dateFromName(basename: string, re: RegExp): string | null {
  const m = re.exec(basename);
  if (!m || !m.groups) return null;
  const { y, m: mo, d } = m.groups as { y?: string; m?: string; d?: string };
  if (!y || !mo || !d) return null;
  const iso = `${y}-${mo}-${d}T00:00:00`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function listJournalNotes(app: App, folderPath: string): TFile[] {
  const folder = app.vault.getAbstractFileByPath(normalizePath(folderPath));
  if (!(folder instanceof TFolder)) {
    throw new Error(`Vault folder not found: ${folderPath}`);
  }
  const out: TFile[] = [];
  const stack: TFolder[] = [folder];
  while (stack.length) {
    const f = stack.pop()!;
    for (const child of f.children) {
      if (child instanceof TFolder) stack.push(child);
      else if (child instanceof TFile && child.extension === "md") out.push(child);
    }
  }
  return out;
}

/** Split body on `## ` headers; each section becomes one entry. Returns the
 *  whole body as a single section if there are no headers. */
function splitSections(body: string): { heading: string | null; text: string }[] {
  const trimmed = body.trim();
  if (!/^##\s+/m.test(trimmed)) return [{ heading: null, text: trimmed }];
  const parts: { heading: string | null; text: string }[] = [];
  const lines = trimmed.split("\n");
  let currentHeading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) parts.push({ heading: currentHeading, text: t });
    buf = [];
  };
  for (const line of lines) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      flush();
      currentHeading = h[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return parts;
}

export async function importObsidianJournal(
  app: App,
  folderPath: string,
  dateFormat: string,
): Promise<RawEntry[]> {
  const re = dateFormatToRegex(dateFormat);
  const files = listJournalNotes(app, folderPath);
  const out: RawEntry[] = [];
  for (const f of files) {
    const basename = f.basename;
    const written = dateFromName(basename, re);
    if (!written) continue; // not a journal note in the configured format
    const text = await app.vault.read(f);
    const body = stripFrontmatter(text).trim();
    if (!body) continue;
    for (const section of splitSections(body)) {
      const userText = section.heading
        ? `**${section.heading}**\n\n${section.text}`
        : section.text;
      out.push({
        written_at: written,
        user_text: userText,
        raw_md: text,
        source: "obsidian-journal",
      });
    }
  }
  return out;
}
