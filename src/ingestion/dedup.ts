/* SHA-256 dedup hash on the normalised user text. */

export function normaliseText(text: string): string {
  return text.normalize("NFC").split(/\s+/).filter(Boolean).join(" ");
}

export async function contentHash(userText: string): Promise<string> {
  const data = new TextEncoder().encode(normaliseText(userText));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
