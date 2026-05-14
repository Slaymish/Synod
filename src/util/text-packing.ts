/* Char-budgeted batching. Same contract as the Python _text_packing module:
 *
 *   pack_entries([(date, body), …], maxChars)
 *     → list[list[block]]   -- one inner list per LLM call
 *
 * Long entries are split into labelled `[date — part k/N]` blocks. No body
 * text is ever silently truncated. Char budget is a coarse proxy for tokens
 * (~1 token / 4 chars for English).
 */

const MIN_REASONABLE_BUDGET = 1000;

export function formatEntry(date: string, body: string): string {
  return `[${date}]\n${body}`;
}

function splitByLines(text: string, max: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of text.split("\n")) {
    const cand = buf ? `${buf}\n${line}` : line;
    if (cand.length <= max) {
      buf = cand;
    } else {
      if (buf) out.push(buf);
      buf = line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const pieces: string[] = [];
  let buf = "";
  for (const para of text.split("\n\n")) {
    const cand = buf ? `${buf}\n\n${para}` : para;
    if (cand.length <= max) {
      buf = cand;
      continue;
    }
    if (buf) {
      pieces.push(buf);
      buf = "";
    }
    if (para.length <= max) {
      buf = para;
    } else {
      for (const chunk of splitByLines(para, max)) {
        if (chunk.length <= max) {
          pieces.push(chunk);
        } else {
          for (let i = 0; i < chunk.length; i += max) {
            pieces.push(chunk.slice(i, i + max));
          }
        }
      }
    }
  }
  if (buf) pieces.push(buf);
  return pieces;
}

export function chunkOversized(date: string, body: string, max: number): string[] {
  if (max < MIN_REASONABLE_BUDGET) {
    throw new Error(
      `maxChars=${max} is below the safe floor of ${MIN_REASONABLE_BUDGET}; ` +
        `refusing to chop entries that small.`,
    );
  }
  const headerOverhead = `[${date} — part 99/99]\n`.length;
  const bodyBudget = Math.max(max - headerOverhead, MIN_REASONABLE_BUDGET / 2);
  const pieces = splitLong(body, bodyBudget);
  if (pieces.length === 1) return [formatEntry(date, pieces[0])];
  return pieces.map((p, i) => `[${date} — part ${i + 1}/${pieces.length}]\n${p}`);
}

export function packBlocks(blocks: string[], max: number): string[][] {
  const sepOverhead = "\n\n---\n\n".length;
  const batches: string[][] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const block of blocks) {
    const cost = block.length + (cur.length ? sepOverhead : 0);
    if (cur.length && curLen + cost > max) {
      batches.push(cur);
      cur = [block];
      curLen = block.length;
    } else {
      cur.push(block);
      curLen += cost;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

export function packEntries(
  entries: { date: string; body: string }[],
  max: number,
): string[][] {
  const blocks: string[] = [];
  for (const e of entries) {
    blocks.push(...chunkOversized(e.date, e.body, max));
  }
  return packBlocks(blocks, max);
}
