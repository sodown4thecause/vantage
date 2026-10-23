/** Digest timing rules, kept pure so they can be unit-tested. */

export type DigestDueInput = {
  digestHourUtc: number;
  /** Local hour in `digestTimeZone`. When both are set they win over the UTC hour, so daylight saving is followed. */
  digestLocalHour?: number | null;
  digestTimeZone?: string | null;
  lastSentAt: Date | null;
  now?: Date;
};

const MIN_HOURS_BETWEEN_DIGESTS = 20;

export function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 13;
  return Math.min(23, Math.max(0, Math.trunc(hour)));
}

/** The calendar date and wall-clock offset (minutes ahead of UTC) of an instant in a time zone. */
function zoned(at: Date, timeZone: string): { year: number; month: number; day: number; offsetMinutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).map((part) => [part.type, part.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    offsetMinutes: Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60_000),
  };
}

/**
 * The instant of `hour`:00 local time on a calendar date in a time zone. The offset is re-read at the candidate
 * instant, so the date's own daylight-saving offset applies. An hour skipped by a daylight-saving jump lands an hour
 * later, as clocks do.
 */
export function zonedHourToInstant(date: { year: number; month: number; day: number }, hour: number, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour);
  let instant = wall - zoned(new Date(wall), timeZone).offsetMinutes * 60_000;
  instant = wall - zoned(new Date(instant), timeZone).offsetMinutes * 60_000;
  return new Date(instant);
}

/** True for an IANA time zone the runtime understands. */
export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The latest daily send slot at or before `now`: local time in the owner's zone when set, otherwise the UTC hour. */
export function latestDigestSlot(input: Omit<DigestDueInput, "lastSentAt">): Date {
  const now = input.now ?? new Date();
  const localHour = input.digestLocalHour;
  if (localHour !== null && localHour !== undefined && isValidTimeZone(input.digestTimeZone)) {
    const timeZone = input.digestTimeZone;
    const today = zoned(now, timeZone);
    const slot = zonedHourToInstant(today, clampHour(localHour), timeZone);
    if (slot.getTime() <= now.getTime()) return slot;
    const yesterday = new Date(Date.UTC(today.year, today.month - 1, today.day - 1));
    return zonedHourToInstant({ year: yesterday.getUTCFullYear(), month: yesterday.getUTCMonth() + 1, day: yesterday.getUTCDate() }, clampHour(localHour), timeZone);
  }
  const scheduledAt = new Date(now);
  scheduledAt.setUTCHours(clampHour(input.digestHourUtc), 0, 0, 0);
  if (scheduledAt.getTime() > now.getTime()) {
    scheduledAt.setUTCDate(scheduledAt.getUTCDate() - 1);
  }
  return scheduledAt;
}

/**
 * A digest is due for the latest elapsed daily slot, provided that slot
 * has not been sent and at least 20 hours have elapsed since the last send.
 * Never-sent workspaces catch up that slot, even before today's preferred hour:
 * without an opt-in timestamp, waiting would strand late hours on sparse crons.
 */
export function isDigestDue(input: DigestDueInput): boolean {
  const now = input.now ?? new Date();
  const scheduledAt = latestDigestSlot({ ...input, now });

  if (input.lastSentAt) {
    if (input.lastSentAt.getTime() >= scheduledAt.getTime()) return false;
    const hoursSinceLast =
      (now.getTime() - input.lastSentAt.getTime()) / (60 * 60 * 1000);
    if (hoursSinceLast < MIN_HOURS_BETWEEN_DIGESTS) return false;
  }
  return true;
}
