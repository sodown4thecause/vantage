/** Digest timing rules, kept pure so they can be unit-tested. */

export type DigestDueInput = {
  digestHourUtc: number;
  lastSentAt: Date | null;
  now?: Date;
};

const MIN_HOURS_BETWEEN_DIGESTS = 20;

export function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 13;
  return Math.min(23, Math.max(0, Math.trunc(hour)));
}

/**
 * A digest is due for the latest elapsed daily UTC slot, provided that slot
 * has not been sent and at least 20 hours have elapsed since the last send.
 * Never-sent workspaces catch up that slot, even before today's preferred hour:
 * without an opt-in timestamp, waiting would strand late hours on sparse crons.
 */
export function isDigestDue(input: DigestDueInput): boolean {
  const now = input.now ?? new Date();
  const scheduledAt = new Date(now);
  scheduledAt.setUTCHours(clampHour(input.digestHourUtc), 0, 0, 0);
  if (scheduledAt.getTime() > now.getTime()) {
    scheduledAt.setUTCDate(scheduledAt.getUTCDate() - 1);
  }

  if (input.lastSentAt) {
    if (input.lastSentAt.getTime() >= scheduledAt.getTime()) return false;
    const hoursSinceLast =
      (now.getTime() - input.lastSentAt.getTime()) / (60 * 60 * 1000);
    if (hoursSinceLast < MIN_HOURS_BETWEEN_DIGESTS) return false;
  }
  return true;
}
