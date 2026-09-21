import type { OutcomeEvent } from "@/lib/outcomes/types";

/** UTC week starting Monday 00:00. */
export function utcWeekBounds(now: Date = new Date()): {
  weekStartUtc: Date;
  weekEndUtc: Date;
} {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diffToMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  const weekStartUtc = new Date(d);
  const weekEndUtc = new Date(d);
  weekEndUtc.setUTCDate(weekEndUtc.getUTCDate() + 7);
  return { weekStartUtc, weekEndUtc };
}

export function computeNorthStar(input: {
  events: Array<{ event: OutcomeEvent; createdAt: Date }>;
  weekStartUtc: Date;
  weekEndUtc: Date;
  /** Opportunities that appeared in queue this week (or proxy). */
  surfacedCount: number;
}): {
  actedOnCount: number;
  usefulCount: number;
  notUsefulCount: number;
  precision: number | null;
  actionRate: number | null;
} {
  const inWeek = input.events.filter(
    (e) => e.createdAt >= input.weekStartUtc && e.createdAt < input.weekEndUtc,
  );
  const actedOnCount = inWeek.filter((e) => e.event === "acted_on").length;
  const usefulCount = inWeek.filter((e) => e.event === "useful").length;
  const notUsefulCount = inWeek.filter((e) => e.event === "not_useful").length;
  const judged = usefulCount + notUsefulCount;
  const precision = judged > 0 ? usefulCount / judged : null;
  const actionRate =
    input.surfacedCount > 0 ? actedOnCount / input.surfacedCount : null;
  return { actedOnCount, usefulCount, notUsefulCount, precision, actionRate };
}
