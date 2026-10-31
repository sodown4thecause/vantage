import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { topicVolumeDaily } from "@/lib/db/schema";

/** A topic needs at least this many mentions in each 7-day window for a WoW number. */
export const MIN_WINDOW_MENTIONS = 5;

export type WowChange = {
  current: number;
  previous: number;
  /** Percent change, null when either window is under the minimum. */
  changePct: number | null;
  status: "ok" | "insufficient";
};

/**
 * This 7 days vs the previous 7 days for one topic. Under 5 mentions in either
 * window the result is "not enough data" rather than a misleading percentage.
 */
export function wowChange(current7: number, previous7: number, minMentions = MIN_WINDOW_MENTIONS): WowChange {
  if (current7 < minMentions || previous7 < minMentions) {
    return { current: current7, previous: previous7, changePct: null, status: "insufficient" };
  }
  if (previous7 === 0) {
    return { current: current7, previous: previous7, changePct: null, status: "insufficient" };
  }
  const changePct = ((current7 - previous7) / previous7) * 100;
  return { current: current7, previous: previous7, changePct, status: "ok" };
}

/** Topic momentum on a 0..1 scale: 0% WoW maps to 0.5, +100% to 1, -100% to 0. */
export function wowToMomentum(change: WowChange): number | null {
  if (change.status !== "ok" || change.changePct === null) return null;
  const clamped = Math.max(-100, Math.min(100, change.changePct));
  return (clamped + 100) / 200;
}

export type TopicWow = { topic: string; wow: WowChange };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The single week-over-week window used by the charts and the scorer: the last
 * 7 completed UTC days against the 7 before them. Today is partial, so it is
 * in neither window. Dates are UTC `YYYY-MM-DD`.
 */
export function wowWindow(now = new Date()): { previousStart: string; currentStart: string; today: string } {
  return {
    previousStart: new Date(now.getTime() - 14 * DAY_MS).toISOString().slice(0, 10),
    currentStart: new Date(now.getTime() - 7 * DAY_MS).toISOString().slice(0, 10),
    today: now.toISOString().slice(0, 10),
  };
}

/** WoW from per-day counts using {@link wowWindow}; days outside the windows are ignored. */
export function wowFromDailyCounts(
  days: ReadonlyArray<{ day: string; mentions: number }>,
  now = new Date(),
): WowChange {
  const { previousStart, currentStart, today } = wowWindow(now);
  let current = 0;
  let previous = 0;
  for (const { day, mentions } of days) {
    if (day >= currentStart && day < today) current += mentions;
    else if (day >= previousStart && day < currentStart) previous += mentions;
  }
  return wowChange(current, previous);
}

/** Sums per-topic mentions over the two windows, straight from topic_volume_daily. */
export async function topicWowForWorkspace(
  workspaceId: string,
  topics: readonly string[],
  now = new Date(),
): Promise<Map<string, WowChange>> {
  const out = new Map<string, WowChange>();
  if (topics.length === 0) return out;
  const { previousStart, currentStart, today } = wowWindow(now);
  const db = getDb();
  const sums = await db
    .select({
      topic: topicVolumeDaily.topic,
      current: sql<number>`coalesce(sum(case when ${topicVolumeDaily.day} >= ${currentStart}::date then ${topicVolumeDaily.mentions} else 0 end), 0)`,
      previous: sql<number>`coalesce(sum(case when ${topicVolumeDaily.day} >= ${previousStart}::date and ${topicVolumeDaily.day} < ${currentStart}::date then ${topicVolumeDaily.mentions} else 0 end), 0)`,
    })
    .from(topicVolumeDaily)
    .where(and(
      eq(topicVolumeDaily.workspaceId, workspaceId),
      gte(topicVolumeDaily.day, previousStart),
      lt(topicVolumeDaily.day, today),
      inArray(topicVolumeDaily.topic, [...topics]),
    ))
    .groupBy(topicVolumeDaily.topic);
  for (const row of sums) {
    out.set(row.topic, wowChange(Number(row.current), Number(row.previous)));
  }
  for (const topic of topics) {
    if (!out.has(topic)) out.set(topic, wowChange(0, 0));
  }
  return out;
}
