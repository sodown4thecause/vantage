import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Array<{ topic: string; day: string; mentions: number }> }));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: async () => state.rows }) }) }),
}));

import { wowFromDailyCounts, wowWindow } from "@/lib/trends/momentum";
import { workspaceTrends } from "@/lib/trends/query";

const now = new Date("2026-10-25T14:00:00Z");

function dayRows(topic: string, entries: Record<string, number>) {
  return Object.entries(entries).map(([day, mentions]) => ({ topic, day, mentions }));
}

describe("one week-over-week window for charts and scores", () => {
  beforeEach(() => {
    state.rows = [];
  });

  it("windows are the last 7 completed UTC days against the 7 before them", () => {
    expect(wowWindow(now)).toEqual({ previousStart: "2026-10-11", currentStart: "2026-10-18", today: "2026-10-25" });
  });

  it("excludes the partial current day from both windows", () => {
    const wow = wowFromDailyCounts([
      { day: "2026-10-25", mentions: 100 },
      { day: "2026-10-24", mentions: 6 },
      { day: "2026-10-17", mentions: 3 },
      { day: "2026-10-10", mentions: 50 },
    ], now);
    expect(wow).toMatchObject({ current: 6, previous: 3 });
  });

  it("workspaceTrends reports the same percentage the scorer reads", async () => {
    state.rows = dayRows("CRM", {
      "2026-10-25": 100, // today, still filling: not part of either window
      "2026-10-24": 5, "2026-10-20": 5,
      "2026-10-17": 5, "2026-10-12": 5,
    });
    const [trend] = await workspaceTrends("ws", { now });
    expect(trend.wow).toEqual(wowFromDailyCounts(
      state.rows.map(({ day, mentions }) => ({ day, mentions })), now,
    ));
    expect(trend.wow).toMatchObject({ current: 10, previous: 10, status: "ok", changePct: 0 });
  });
});
