/* Defensive JSON parsing for LLM responses. Local models love to wrap output
 * in ```json fences, prepend an introductory paragraph, or append apologies.
 * We strip fences, find the first balanced JSON object/array, then parse.
 *
 * Throws SyntaxError on hard failure — callers must handle.
 */

export function parseLooseJson(raw: string): unknown {
  let s = raw.trim();

  // Strip ```json … ``` fences.
  if (s.includes("```")) {
    const parts = s.split("```");
    for (let i = 1; i < parts.length; i++) {
      let p = parts[i];
      if (p.startsWith("json")) p = p.slice(4);
      p = p.trim();
      if (p) {
        s = p;
        break;
      }
    }
  }

  // Find the first balanced { … } or [ … ] in the string.
  const start = s.search(/[{[]/);
  if (start < 0) return JSON.parse(s); // let it throw the real error
  const opener = s[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === opener) depth++;
    else if (c === closer) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const slice = end > 0 ? s.slice(start, end + 1) : s.slice(start);
  return JSON.parse(slice);
}
