/**
 * Helpers for raw `db.execute()` results, which are untyped: neon-http returns either an array or an
 * object with `rows`. Narrow before trusting a value instead of casting it.
 */
export function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (typeof result !== "object" || result === null) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

/** Reads `row[key]` as a finite number (numbers and numeric strings, as Postgres returns numeric). Null if absent or invalid. */
export function numericField(row: unknown, key: string): number | null {
  if (typeof row !== "object" || row === null) return null;
  const value = (row as Record<string, unknown>)[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
