/* Ollama backend. Uses /api/chat (non-streaming) for one-shot JSON-friendly
 * completions. We deliberately do not use streaming here — the agent
 * pipeline only needs the final string and streaming complicates the
 * single-flight semaphore.
 */

import { requestUrl } from "obsidian";

interface OllamaOpts {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  format?: "json";
  temperature?: number;
  signal?: AbortSignal;
}

export async function callOllama(opts: OllamaOpts): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    stream: false,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    options: {
      temperature: opts.temperature ?? 0.4,
    },
  };
  if (opts.format) body.format = opts.format;

  const resp = await requestUrl({
    url: `${opts.baseUrl.replace(/\/$/, "")}/api/chat`,
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify(body),
    throw: false,
  });
  if (resp.status >= 400) {
    throw new Error(`Ollama HTTP ${resp.status}: ${resp.text.slice(0, 300)}`);
  }
  // /api/chat returns { message: { role, content }, done, ... }
  const json = resp.json as { message?: { content?: string }; error?: string };
  if (json.error) throw new Error(`Ollama error: ${json.error}`);
  return json.message?.content ?? "";
}
