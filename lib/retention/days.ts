export const DEFAULT_TIME_ZONE = "UTC";

export function safeTimeZone(zone: string | null | undefined): string {
  if (!zone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function localParts(at: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

/** Calendar day (YYYY-MM-DD) of an instant in the workspace's time zone. */
export function localDay(at: Date, timeZone: string): string {
  const { year, month, day } = localParts(at, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The calendar day before a YYYY-MM-DD day. Calendar arithmetic only, so DST never skews it. */
export function previousDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}

/** The instant the current local month began in the workspace's time zone. */
export function startOfLocalMonth(at: Date, timeZone: string): Date {
  const { year, month } = localParts(at, timeZone);
  const guess = Date.UTC(year, month - 1, 1);
  const local = localParts(new Date(guess), timeZone);
  const shown = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  let start = guess - (shown - guess);
  const check = localParts(new Date(start), timeZone);
  if (check.day !== 1 || check.month !== month) start = guess - (Date.UTC(check.year, check.month - 1, check.day, check.hour, check.minute, check.second) - start);
  return new Date(start);
}
