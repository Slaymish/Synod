/* OpenAI-compatible chat-completions backend. Used for OpenRouter and
 * llama-swap. */

import { requestUrl } from "obsidian";

import { LlmHttpError, LlmNetworkError } from "./errors";

interface OpenAIOpts {
  baseUrl: string;       // e.g. https://openrouter.ai/api/v1
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  extraHeaders?: Record<string, string>;
  signal?: AbortSignal;
}

export async function callOpenAICompat(opts: OpenAIOpts): Promise<string> {
  const body = {
    model: opts.model,
    temperature: opts.temperature ?? 0.4,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${opts.apiKey || "no-key"}`,
    ...opts.extraHeaders,
  };

  let resp;
  try {
    resp = await requestUrl({
      url: `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      throw: false,
    });
  } catch (e) {
    // requestUrl throws on transport failure (DNS, refused, offline).
    throw new LlmNetworkError(`LLM endpoint unreachable: ${(e as Error).message}`);
  }

  if (resp.status >= 400) {
    throw new LlmHttpError(`LLM HTTP ${resp.status}: ${resp.text.slice(0, 300)}`, resp.status);
  }
  const json = resp.json as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (json.error) throw new Error(`LLM error: ${json.error.message ?? "unknown"}`);
  return json.choices?.[0]?.message?.content ?? "";
}
