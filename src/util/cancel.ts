/* Cooperative cancellation helpers.
 *
 * Obsidian's `requestUrl` does not honour AbortSignal, so we cannot abort an
 * LLM call mid-flight. Instead the pipeline checks the signal between calls
 * (in particular: before queuing on the single-flight gate, and between
 * value-agent / compiler stages) and throws CancelError when the user has
 * asked to stop. Every broad `catch` must rethrow CancelError so a cancel
 * cannot be silently swallowed as a transient failure.
 */

export class CancelError extends Error {
  constructor(message = "Run cancelled by user.") {
    super(message);
    this.name = "CancelError";
  }
}

export function isCancelError(e: unknown): e is CancelError {
  return e instanceof CancelError || (e instanceof Error && e.name === "CancelError");
}

export function throwIfAborted(signal: AbortSignal | undefined, where = ""): void {
  if (signal?.aborted) throw new CancelError(where ? `Cancelled before ${where}.` : undefined);
}
