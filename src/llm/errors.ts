/* Typed LLM errors so the retry layer in llm/index.ts can decide whether a
 * failure is transient (network blip, HTTP 5xx) or terminal (bad API key,
 * unknown model, schema-level error). */

export class LlmHttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "LlmHttpError";
  }
}

export class LlmNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmNetworkError";
  }
}

export function isTransientLlmError(e: unknown): boolean {
  if (e instanceof LlmNetworkError) return true;
  if (e instanceof LlmHttpError) return e.status >= 500 && e.status < 600;
  return false;
}
