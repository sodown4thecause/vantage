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
 * A digest is due once the workspace's preferred UTC hour has passed and at
 * least 20 hours have elapsed since the last send (or it has never sent).
 */
export function isDigestDue(input: DigestDueInput): boolean {
  const now = input.now ?? new Date();
  if (input.lastSentAt) {
    const hoursSinceLast =
      (now.getTime() - input.lastSentAt.getTime()) / (60 * 60 * 1000);
    if (hoursSinceLast < MIN_HOURS_BETWEEN_DIGESTS) return false;
  }
  return now.getUTCHours() >= clampHour(input.digestHourUtc);
}
