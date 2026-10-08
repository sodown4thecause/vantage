/** Display helpers for the public destination pages (pure; no I/O). */

/** Proposed re-verification interval (plan section 9.5): rows older than this show as stale. */
export const STALE_AFTER_DAYS = 90;

export function humanize(value: string): string {
  if (value === "unknown") return "Not verified";
  return value.replace(/_/g, " ");
}

/** True when `lastVerified` (YYYY-MM-DD) is more than STALE_AFTER_DAYS before `now`. */
export function isStale(lastVerified: string, now: Date = new Date()): boolean {
  const verified = new Date(`${lastVerified}T00:00:00Z`).getTime();
  if (Number.isNaN(verified)) return true;
  return now.getTime() - verified > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** Requirements are free-form JSON; render only string and boolean leaves as short lines. */
export function requirementLines(requirements: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(requirements)) {
    const label = key.replace(/_/g, " ");
    if (typeof value === "string" && value.trim()) lines.push(`${label}: ${value.trim()}`);
    else if (typeof value === "boolean") lines.push(`${label}: ${value ? "yes" : "no"}`);
    else if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
      if (items.length) lines.push(`${label}: ${items.join("; ")}`);
    }
  }
  return lines;
}
