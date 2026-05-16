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
import { CancelError, isCancelError, throwIfAborted } from "../src/util/cancel";
import { isTransientLlmError, LlmHttpError, LlmNetworkError } from "../src/llm/errors";
import { renderBulletin } from "../src/output/bulletin";
import type { DecisionPacket } from "../src/agents/types";

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

  // ── Cancellation primitives ──
  ok("isCancelError detects CancelError instance",
    isCancelError(new CancelError()) === true);
  ok("isCancelError rejects regular Error",
    isCancelError(new Error("nope")) === false);
  const ac = new AbortController();
  ac.abort();
  let threw: unknown = null;
  try {
    throwIfAborted(ac.signal, "test");
  } catch (e) {
    threw = e;
  }
  ok("throwIfAborted throws on aborted signal", isCancelError(threw));
  let didNotThrow = true;
  try {
    throwIfAborted(new AbortController().signal, "test");
  } catch {
    didNotThrow = false;
  }
  ok("throwIfAborted is a no-op on un-aborted signal", didNotThrow);

  // ── LLM transient-error classification ──
  ok("HTTP 503 is transient", isTransientLlmError(new LlmHttpError("x", 503)));
  ok("HTTP 500 is transient", isTransientLlmError(new LlmHttpError("x", 500)));
  ok("HTTP 401 is NOT transient", !isTransientLlmError(new LlmHttpError("x", 401)));
  ok("HTTP 404 is NOT transient", !isTransientLlmError(new LlmHttpError("x", 404)));
  ok("network error is transient", isTransientLlmError(new LlmNetworkError("offline")));
  ok("vanilla Error is NOT transient", !isTransientLlmError(new Error("bad json")));

  // ── Bulletin renderer surfaces open questions ──
  const packet: DecisionPacket = {
    packet_id: "p1",
    period_start: "2025-01-01T00:00:00.000Z",
    period_end: "2025-01-07T00:00:00.000Z",
    summary: "test",
    consolidated_observations: [],
    unanimous_recommendations: [],
    tensions_for_user: [],
    minority_reports: [],
    open_questions: [
      { value_name: "Honesty", questions: ["Why did I dodge that conversation on Thursday?"] },
      { value_name: "Family", questions: ["Is weekly dinner sustainable next quarter?"] },
    ],
    reopen_conditions: [],
  };
  const md = renderBulletin(packet);
  ok("bulletin includes 'Open questions' heading", md.includes("## Open questions"));
  ok("bulletin includes per-value question",
    md.includes("Why did I dodge that conversation on Thursday?"));
  ok("bulletin labels questions by value name",
    md.includes("**Honesty**") && md.includes("**Family**"));

  // Packet with no open_questions field (back-compat) must still render.
  const oldPacket: DecisionPacket = { ...packet, open_questions: undefined };
  const oldMd = renderBulletin(oldPacket);
  ok("bulletin renders without open_questions field",
    !oldMd.includes("## Open questions"));

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
