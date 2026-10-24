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
  events: Array<{ event: OutcomeEvent; createdAt: Date; opportunityId?: string }>;
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
  // "sent" and "replied" are the owner's own marks and replaced the old "acted on" button. A
  // conversation marked both counts once.
  const acted = inWeek.filter((e) => e.event === "acted_on" || e.event === "sent" || e.event === "replied");
  const actedOnCount = new Set(acted.map((e, index) => e.opportunityId ?? `event-${index}`)).size;
  const usefulCount = inWeek.filter((e) => e.event === "useful").length;
  const notUsefulCount = inWeek.filter((e) => e.event === "not_useful").length;
  const judged = usefulCount + notUsefulCount;
  const precision = judged > 0 ? usefulCount / judged : null;
  const actionRate =
    input.surfacedCount > 0 ? actedOnCount / input.surfacedCount : null;
  return { actedOnCount, usefulCount, notUsefulCount, precision, actionRate };
}
