/* LLM provider abstraction. Returns a single function that takes
 * (systemPrompt, userPrompt) and returns the raw text response.
 *
 * Supported providers (configured via SynodSettings.provider):
 *   ollama       — local Ollama server
 *   openrouter   — OpenRouter API (OpenAI-compatible)
 *   llama_swap   — llama-swap proxy (OpenAI-compatible)
 *
 * Roles:
 *   "agent"    — fast/cheap model used by value agents and the tension finder
 *   "compiler" — stronger model used by validator passes
 */

import { agentModelFor, compilerModelFor, SynodSettings } from "../settings";
import { log } from "../util/log";
import { callOllama } from "./ollama";
import { callOpenAICompat } from "./openai-compat";

export type Role = "agent" | "compiler";

export interface LlmCallOpts {
  /** Soft request to the backend that we want JSON. We still parse defensively. */
  expectJson?: boolean;
  /** Optional generation temperature; backend may ignore. */
  temperature?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

export type LlmFn = (
  system: string,
  user: string,
  opts?: LlmCallOpts,
) => Promise<string>;

/** Single in-flight gate so backends with one GPU lane (llama-swap, single-GPU
 *  Ollama) don't trample each other when value agents fan out in parallel.
 *  When a backend supports concurrency, raise this in settings later. */
let _inflight: Promise<unknown> = Promise.resolve();

export function getLlm(settings: SynodSettings, role: Role): LlmFn {
  const model = role === "agent" ? agentModelFor(settings) : compilerModelFor(settings);
  return async (system, user, opts = {}) => {
    // Funnel through a single semaphore.
    const prev = _inflight;
    let release!: () => void;
    _inflight = new Promise<void>((res) => (release = res));
    try {
      await prev;
      return await dispatch(settings, model, system, user, opts);
    } catch (e) {
      log.warn(`[llm:${role}] ${(e as Error).message}`);
      throw e;
    } finally {
      release();
    }
  };
}

async function dispatch(
  settings: SynodSettings,
  model: string,
  system: string,
  user: string,
  opts: LlmCallOpts,
): Promise<string> {
  switch (settings.provider) {
    case "ollama":
      return callOllama({
        baseUrl: settings.ollama.baseUrl,
        model,
        system,
        user,
        format: opts.expectJson ? "json" : undefined,
        temperature: opts.temperature,
        signal: opts.signal,
      });
    case "openrouter":
      return callOpenAICompat({
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: settings.openrouter.apiKey,
        model,
        system,
        user,
        temperature: opts.temperature,
        extraHeaders: {
          "HTTP-Referer": "https://github.com/synod",
          "X-Title": "Synod",
        },
        signal: opts.signal,
      });
    case "llama_swap":
      return callOpenAICompat({
        baseUrl: `${settings.llamaSwap.baseUrl}/v1`,
        apiKey: "no-key",
        model,
        system,
        user,
        temperature: opts.temperature,
        signal: opts.signal,
      });
  }
}
