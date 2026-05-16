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
 *
 * Reliability:
 *   - Single-flight gate so backends with one GPU lane don't trample
 *     each other when value agents fan out.
 *   - Up to two retries with linear backoff for transient errors only
 *     (network failures, HTTP 5xx). 4xx and schema errors are surfaced
 *     immediately.
 *   - Cancellation is checked before queuing, before dispatch, and before
 *     each retry sleep, so a `cancel` while a queue is backed up takes
 *     effect at the next pending call.
 */

import { agentModelFor, compilerModelFor, SynodSettings } from "../settings";
import { CancelError, throwIfAborted } from "../util/cancel";
import { log } from "../util/log";
import { isTransientLlmError } from "./errors";
import { callOllama } from "./ollama";
import { callOpenAICompat } from "./openai-compat";

export type Role = "agent" | "compiler";

export interface LlmCallOpts {
  /** Soft request to the backend that we want JSON. We still parse defensively. */
  expectJson?: boolean;
  /** Optional generation temperature; backend may ignore. */
  temperature?: number;
  /** Abort signal for cooperative cancellation. */
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

const RETRY_BACKOFF_MS = [500, 1500];

export function getLlm(settings: SynodSettings, role: Role): LlmFn {
  const model = role === "agent" ? agentModelFor(settings) : compilerModelFor(settings);
  return async (system, user, opts = {}) => {
    throwIfAborted(opts.signal, "LLM enqueue");

    const prev = _inflight;
    let release!: () => void;
    _inflight = new Promise<void>((res) => (release = res));
    try {
      await prev;
      throwIfAborted(opts.signal, "LLM dispatch");
      return await callWithRetry(settings, model, system, user, opts, role);
    } finally {
      release();
    }
  };
}

async function callWithRetry(
  settings: SynodSettings,
  model: string,
  system: string,
  user: string,
  opts: LlmCallOpts,
  role: Role,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    throwIfAborted(opts.signal, `LLM attempt ${attempt + 1}`);
    try {
      return await dispatch(settings, model, system, user, opts);
    } catch (e) {
      if (e instanceof CancelError) throw e;
      lastErr = e;
      if (!isTransientLlmError(e) || attempt === RETRY_BACKOFF_MS.length) {
        log.warn(`[llm:${role}] ${(e as Error).message}`);
        throw e;
      }
      const delay = RETRY_BACKOFF_MS[attempt];
      log.warn(
        `[llm:${role}] transient failure (attempt ${attempt + 1}); retrying in ${delay}ms — ${
          (e as Error).message
        }`,
      );
      await sleep(delay, opts.signal);
    }
  }
  throw lastErr ?? new Error("LLM retry loop exhausted without an error");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelError("Cancelled during backoff."));
      return;
    }
    const id = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new CancelError("Cancelled during backoff."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
          "HTTP-Referer": "https://github.com/Slaymish/Synod",
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
