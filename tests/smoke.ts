/* Pure-function smoke test — exercises the parsers / hashes / packers
 * without touching the Obsidian API. Run with:
 *   node tests/smoke.cjs
 * after `npm run build:test`.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

import { parseRosebud } from "../src/importers/rosebud";
import { contentHash, normaliseText } from "../src/ingestion/dedup";
import { packEntries, chunkOversized } from "../src/util/text-packing";
import { parseLooseJson } from "../src/agents/json";

let failed = 0;
function ok(name: string, cond: unknown, detail?: string) {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  // ── Dedup ──
  ok("normaliseText collapses whitespace",
    normaliseText("hello   world\n\n") === "hello world");
  const h1 = await contentHash("Hello world");
  const h2 = await contentHash("Hello world\n");
  ok("contentHash is whitespace-stable", h1 === h2, `${h1} vs ${h2}`);
  ok("contentHash differs for different text",
    (await contentHash("a")) !== (await contentHash("b")));

  // ── Text packing ──
  const blocks = chunkOversized("2025-01-01", "x".repeat(5000), 2000);
  ok("oversized entries split into part-blocks", blocks.length > 1);
  ok("every part-block has the part header",
    blocks.every((b) => /\[2025-01-01 — part \d+\/\d+\]/.test(b)));

  const batches = packEntries(
    [{ date: "2025-01-01", body: "small one" }, { date: "2025-01-02", body: "small two" }],
    1000,
  );
  ok("two small entries pack into one batch", batches.length === 1 && batches[0].length === 2);

  // ── JSON parser ──
  const parsed = parseLooseJson("Sure! Here is the JSON:\n```json\n{\"a\": 1}\n```\nLet me know if…");
  ok("parseLooseJson strips fences + chatter",
    JSON.stringify(parsed) === '{"a":1}');
  const arr = parseLooseJson("[1,2,{\"k\":\"v\"}]");
  ok("parseLooseJson handles arrays",
    JSON.stringify(arr) === '[1,2,{"k":"v"}]');

  // ── Rosebud parser ──
  const fixturePath = resolve(__dirname, "fixtures/rosebud_export_new_format.md");
  const fixtureBytes = readFileSync(fixturePath);
  const entries = parseRosebud("rosebud_export_new_format.md", fixtureBytes.buffer.slice(
    fixtureBytes.byteOffset,
    fixtureBytes.byteOffset + fixtureBytes.byteLength,
  ));
  ok("rosebud new-format yields 3 entries", entries.length === 3,
    `got ${entries.length}`);
  ok("rosebud entries have user_text",
    entries.every((e) => e.user_text.length > 10));
  ok("rosebud captures emotions/topics tags",
    entries[0].tags?.includes("anxious") === true);
  ok("rosebud source label is 'rosebud'",
    entries.every((e) => e.source === "rosebud"));

  const oldPath = resolve(__dirname, "fixtures/rosebud_export_sample.md");
  const oldBytes = readFileSync(oldPath);
  const oldEntries = parseRosebud("rosebud_export_sample.md", oldBytes.buffer.slice(
    oldBytes.byteOffset, oldBytes.byteOffset + oldBytes.byteLength,
  ));
  ok("rosebud old-format yields ≥1 entry", oldEntries.length >= 1,
    `got ${oldEntries.length}`);

  if (failed) {
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll smoke tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
