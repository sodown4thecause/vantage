import { and, eq, gte, lt } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { topicVolumeDaily } from "@/lib/db/schema";
import { wowFromDailyCounts, type WowChange } from "@/lib/trends/momentum";

export type TopicTrend = {
  topic: string;
  /** Mentions across the whole 28-day window. */
  total: number;
  wow: WowChange;
  /** One entry per day, oldest first, zero-filled. */
  days: Array<{ day: string; mentions: number }>;
};

const DEFAULT_TOP = 10;
const WINDOW_DAYS = 28;

/**
 * The workspace's busiest topics over the last 28 days with daily counts and a
 * week-over-week percentage. Workspace-scoped by every clause.
 */
export async function workspaceTrends(
  workspaceId: string,
  opts: { now?: Date; top?: number } = {},
): Promise<TopicTrend[]> {
  const now = opts.now ?? new Date();
  const top = Math.max(1, Math.floor(opts.top ?? DEFAULT_TOP));
  const dayMs = 24 * 60 * 60 * 1000;
  const startDay = new Date(now.getTime() - (WINDOW_DAYS - 1) * dayMs).toISOString().slice(0, 10);
  const rows = await getDb()
    .select({ topic: topicVolumeDaily.topic, day: topicVolumeDaily.day, mentions: topicVolumeDaily.mentions })
    .from(topicVolumeDaily)
    .where(and(
      eq(topicVolumeDaily.workspaceId, workspaceId),
      gte(topicVolumeDaily.day, startDay),
      lt(topicVolumeDaily.day, new Date(now.getTime() + dayMs).toISOString().slice(0, 10)),
    ));

  const perTopic = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let days = perTopic.get(row.topic);
    if (!days) {
      days = new Map();
      perTopic.set(row.topic, days);
    }
    days.set(row.day, (days.get(row.day) ?? 0) + row.mentions);
  }

  const ranked = [...perTopic.entries()]
    .map(([topic, days]) => ({ topic, total: [...days.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.topic.localeCompare(b.topic))
    .slice(0, top);

  return ranked.map(({ topic, total }) => {
    const days = perTopic.get(topic)!;
    const dayList = Array.from({ length: WINDOW_DAYS }, (_, i) => {
      const day = new Date(now.getTime() - (WINDOW_DAYS - 1 - i) * dayMs).toISOString().slice(0, 10);
      return { day, mentions: days.get(day) ?? 0 };
    });
    // Same completed-day window the scorer reads (topicWowForWorkspace).
    const wow = wowFromDailyCounts(dayList, now);
    return { topic, total, wow, days: dayList };
  });
}
