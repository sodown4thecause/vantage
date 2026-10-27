/** The next scheduled scan as a wall-clock time in the owner's zone, or null when the zone is unknown to the runtime. */
export function formatNextScan(nextScanAt: string, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(nextScanAt));
  } catch {
    return null;
  }
}
