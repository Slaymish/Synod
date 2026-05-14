/* Rosebud importer. Handles two export formats:
 *
 *   NEW (current Rosebud bulk export):
 *     # 🌹 Rosebud entries
 *     ## 📋 Entry Title
 *     ### Thursday, May 14th, 2026
 *     #### Tags
 *     **Emotions:** ...
 *     **Topics:** ...
 *     #### Reflection
 *     [user text]
 *     ---
 *
 *   OLD (legacy single-entry or zip export):
 *     ---
 *     date: 2024-01-15
 *     ---
 *     # January 15, 2024
 *     **Rosebud**: <prompt>
 *     **Me**: <user response>
 *
 * `.zip` files are unpacked in-memory and each .md inside parsed individually.
 */

import type { RawEntry } from "../ingestion/types";

const NEW_HEADER_RE = /^#\s+.*Rosebud/im;
const H2_TITLE_RE = /^##\s+(.+)$/m;
const H3_DATE_RE = /^###\s+(.+)$/m;
const SECTION_RE = /^####\s+(.+?)\s*\n([\s\S]*?)(?=^####\s|(?![\s\S]))/gm;
const ORDINAL_RE = /(\d+)(st|nd|rd|th)\b/gi;
const DAY_OF_WEEK_RE = /^[A-Za-z]+,\s*/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u{10000}-\u{10FFFF}]+\s*/gu;

const FRONTMATTER_RE = /^---\s*\ndate:\s*(.+?)\s*\n---/m;
const ROSEBUD_TURN_RE = /\*\*Rosebud\*\*:\s*([\s\S]*?)(?=\n\*\*|\n---|(?![\s\S]))/g;
const USER_TURN_RE = /\*\*Me\*\*:\s*([\s\S]*?)(?=\n\*\*|\n---|(?![\s\S]))/g;
const SUMMARY_RE = /^\*Summary:([\s\S]*?)\*\s*$/m;
const H1_DATE_RE = /^#\s+(.+)$/m;

const SKIP_SECTIONS = new Set(["tags", "emotions", "topics"]);

function parseDate(raw: string): string {
  let s = raw.trim().replace(DAY_OF_WEEK_RE, "");
  s = s.replace(ORDINAL_RE, "$1");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function parseNewEntry(block: string): RawEntry | null {
  const h2 = H2_TITLE_RE.exec(block);
  const h3 = H3_DATE_RE.exec(block);
  if (!h3) return null;

  const writtenAt = parseDate(h3[1]);
  const sections: Record<string, string> = {};
  // Reset stateful global regex on a fresh string each call.
  const sectionRe = new RegExp(SECTION_RE.source, SECTION_RE.flags);
  for (let m: RegExpExecArray | null; (m = sectionRe.exec(block)); ) {
    sections[m[1].trim().toLowerCase()] = m[2].trim();
  }

  const textParts: string[] = [];
  for (const [name, content] of Object.entries(sections)) {
    if (SKIP_SECTIONS.has(name) || !content) continue;
    textParts.push(content);
  }

  if (!textParts.length) {
    let after = block.slice(h3.index + h3[0].length).trim();
    after = after.replace(/^####\s+Tags\b[\s\S]*?(?=^####\s|(?![\s\S]))/m, "").trim();
    if (after) textParts.push(after);
  }

  const userText = textParts.join("\n\n").trim();
  if (!userText) return null;

  const tagsRaw = sections["tags"] ?? "";
  const tagList: string[] = [];
  for (const m of tagsRaw.matchAll(/\*\*Emotions?\*\*:\s*(.+)/g)) {
    tagList.push(...m[1].split(",").map((t) => t.trim()).filter(Boolean));
  }
  for (const m of tagsRaw.matchAll(/\*\*Topics?\*\*:\s*(.+)/g)) {
    tagList.push(...m[1].split(",").map((t) => t.trim()).filter(Boolean));
  }

  const title = h2 ? h2[1].replace(EMOJI_RE, "").trim() : "";
  return {
    written_at: writtenAt,
    user_text: title ? `**${title}**\n\n${userText}` : userText,
    rosebud_ai_text: tagsRaw || undefined,
    tags: tagList,
    raw_md: block,
    source: "rosebud",
  };
}

function parseNewFormat(content: string): RawEntry[] {
  const blocks = content.split(/\n---+\n/);
  const out: RawEntry[] = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!H2_TITLE_RE.test(block)) continue;
    const entry = parseNewEntry(block);
    if (entry) out.push(entry);
  }
  return out;
}

function extractOldTurns(block: string): { user: string; ai: string } {
  const userParts: string[] = [];
  for (const m of block.matchAll(USER_TURN_RE)) userParts.push(m[1].trim());
  const aiParts: string[] = [];
  for (const m of block.matchAll(ROSEBUD_TURN_RE)) aiParts.push(m[1].trim());
  const summary = SUMMARY_RE.exec(block);
  if (summary) aiParts.push(`[Summary] ${summary[1].trim()}`);
  return { user: userParts.join("\n\n"), ai: aiParts.join("\n\n") };
}

function parseOldEntry(content: string): RawEntry[] {
  const dateMatch = FRONTMATTER_RE.exec(content);
  let writtenAt: string;
  if (dateMatch) writtenAt = parseDate(dateMatch[1]);
  else {
    const h1 = H1_DATE_RE.exec(content);
    writtenAt = h1 ? parseDate(h1[1]) : new Date().toISOString();
  }
  const { user, ai } = extractOldTurns(content);
  if (!user.trim()) return [];
  return [
    {
      written_at: writtenAt,
      user_text: user,
      rosebud_ai_text: ai || undefined,
      raw_md: content,
      source: "rosebud",
    },
  ];
}

function parseOldBulk(content: string): RawEntry[] {
  const blocks = content.split(/\n(?=---\s*\ndate:)/);
  const out: RawEntry[] = [];
  for (const block of blocks) out.push(...parseOldEntry(block.trim()));
  return out;
}

function parseMarkdown(content: string): RawEntry[] {
  if (NEW_HEADER_RE.test(content) || H2_TITLE_RE.test(content)) {
    return parseNewFormat(content);
  }
  if ((content.match(/date:/g) ?? []).length > 1) return parseOldBulk(content);
  return parseOldEntry(content);
}

/* ── ZIP unpacking ─────────────────────────────────────────────────────────
 * Rosebud's old export was a zip of one .md per entry. We implement a tiny
 * inline ZIP reader so we don't pull in a 30-kB dependency for one feature.
 * Supports stored (00) and deflate (08) entries — what Rosebud actually emits.
 */

// Node's zlib ships with Electron — esbuild marks it external via builtin-modules.
import { inflateRawSync } from "zlib";

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function readZip(bytes: ArrayBuffer): ZipEntry[] {
  const view = new DataView(bytes);
  const u8 = new Uint8Array(bytes);
  // End-of-central-directory record: scan the last 64 KiB for 0x06054b50
  let eocd = -1;
  const end = Math.max(0, u8.length - 65557);
  for (let i = u8.length - 22; i >= end; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP: end-of-central-directory not found");
  const cdCount = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  const td = new TextDecoder();
  for (let n = 0; n < cdCount; n++) {
    if (view.getUint32(cdOffset, true) !== 0x02014b50) {
      throw new Error("ZIP: bad central-directory signature");
    }
    const method = view.getUint16(cdOffset + 10, true);
    const compSize = view.getUint32(cdOffset + 20, true);
    const uncompSize = view.getUint32(cdOffset + 24, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const name = td.decode(u8.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
    cdOffset += 46 + nameLen + extraLen + commentLen;

    // Local file header to find the data start
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = u8.subarray(dataStart, dataStart + compSize);

    let data: Uint8Array;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = new Uint8Array(inflateRawSync(Buffer.from(compressed)));
      if (uncompSize && data.length !== uncompSize) {
        // Trust the header but keep going — Rosebud sometimes stores a 0
        // here when the entry is empty.
      }
    } else {
      throw new Error(`ZIP: unsupported compression method ${method} for ${name}`);
    }
    entries.push({ name, data });
  }
  return entries;
}

function parseZip(bytes: ArrayBuffer): RawEntry[] {
  const td = new TextDecoder("utf-8", { fatal: false });
  const entries = readZip(bytes)
    .filter((e) => e.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name));
  const out: RawEntry[] = [];
  for (const e of entries) {
    out.push(...parseOldEntry(td.decode(e.data)));
  }
  return out;
}

export function parseRosebud(filename: string, bytes: ArrayBuffer): RawEntry[] {
  if (filename.toLowerCase().endsWith(".zip")) return parseZip(bytes);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return parseMarkdown(text);
}
