/* Time helpers — single source of truth for ISO formatting. */

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoMinusDays(days: number, base: Date = new Date()): string {
  const d = new Date(base.getTime() - days * 86_400_000);
  return d.toISOString();
}

export function shortDate(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

export function formatLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
