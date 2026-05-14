/* Lightweight logger — fans out to console + Synod status view subscribers. */

type Level = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: Level;
  msg: string;
}

type Listener = (entry: LogEntry) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(level: Level, msg: string) {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg };
  // Per Obsidian plugin guidelines, the developer console should not be
  // noisy. Only surface warnings and errors. `info`/`debug` still reach
  // the in-app status view through the listener fan-out below.
  if (level === "warn" || level === "error") {
    // eslint-disable-next-line no-console
    console[level](`[synod] ${msg}`);
  }
  for (const l of listeners) {
    try {
      l(entry);
    } catch {
      /* noop */
    }
  }
}

export const log = {
  debug: (m: string) => emit("debug", m),
  info: (m: string) => emit("info", m),
  warn: (m: string) => emit("warn", m),
  error: (m: string) => emit("error", m),
};

export function uuid(): string {
  // Crypto.randomUUID is available in Electron renderer (≥ Obsidian 1.0).
  return crypto.randomUUID();
}
