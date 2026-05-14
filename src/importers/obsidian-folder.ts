/* Obsidian folder importer.
 *
 * Treats every .md file under the given vault folder as one entry. The
 * `written_at` timestamp is determined in this priority:
 *   1. YAML frontmatter `date:` / `created:` field
 *   2. A YYYY-MM-DD prefix in the filename
 *   3. The file's mtime
 *
 * Tags from frontmatter `tags:` are preserved. Frontmatter is stripped from
 * the body before hashing so re-saving the file (touching frontmatter) does
 * not generate a new entry.
 */

import { App, normalizePath, TFile, TFolder } from "obsidian";

import type { RawEntry } from "../ingestion/types";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const FILENAME_DATE_RE = /(\d{4}-\d{2}-\d{2})/;

interface FrontMatter {
  date?: string;
  tags?: string[];
}

function parseFrontmatter(text: string): { fm: FrontMatter; body: string } {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { fm: {}, body: text };
  const body = text.slice(m[0].length);
  const fm: FrontMatter = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (key === "date" || key === "created") {
      fm.date = raw.trim().replace(/^['"]|['"]$/g, "");
    } else if (key === "tags") {
      // Inline list `[a, b]` or single value
      const v = raw.trim();
      if (v.startsWith("[") && v.endsWith("]")) {
        fm.tags = v
          .slice(1, -1)
          .split(",")
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } else if (v) {
        fm.tags = [v.replace(/^['"]|['"]$/g, "")];
      }
    }
  }
  return { fm, body };
}

function dateFromFilename(name: string): string | null {
  const m = FILENAME_DATE_RE.exec(name);
  return m ? m[1] : null;
}

function toIso(input: string | undefined, fallbackEpoch: number): string {
  if (input) {
    const d = new Date(input);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date(fallbackEpoch).toISOString();
}

function listMarkdownIn(app: App, folderPath: string): TFile[] {
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

export async function importObsidianFolder(app: App, folderPath: string): Promise<RawEntry[]> {
  const files = listMarkdownIn(app, folderPath);
  const out: RawEntry[] = [];
  for (const f of files) {
    const text = await app.vault.read(f);
    const { fm, body } = parseFrontmatter(text);
    const cleanBody = body.trim();
    if (!cleanBody) continue;
    const writtenAt = toIso(
      fm.date ?? dateFromFilename(f.name) ?? undefined,
      f.stat.mtime,
    );
    out.push({
      written_at: writtenAt,
      user_text: cleanBody,
      tags: fm.tags,
      raw_md: text,
      source: "obsidian-folder",
    });
  }
  return out;
}
