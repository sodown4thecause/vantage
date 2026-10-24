import { describe, expect, it } from "vitest";

import {
  computeNorthStar,
  utcWeekBounds,
} from "../lib/outcomes/metrics";

describe("north-star metric week bounds", () => {
  it("uses Monday 00:00 UTC week boundaries", () => {
    // Wednesday 2026-09-16
    const { weekStartUtc, weekEndUtc } = utcWeekBounds(
      new Date("2026-09-16T15:00:00.000Z"),
    );
    expect(weekStartUtc.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(weekEndUtc.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("computes acted-on, precision, and action rate", () => {
    const { weekStartUtc, weekEndUtc } = utcWeekBounds(
      new Date("2026-09-16T12:00:00.000Z"),
    );
    const stats = computeNorthStar({
      weekStartUtc,
      weekEndUtc,
      surfacedCount: 10,
      events: [
        { event: "useful", createdAt: new Date("2026-09-15T10:00:00.000Z") },
        { event: "useful", createdAt: new Date("2026-09-15T11:00:00.000Z") },
        { event: "not_useful", createdAt: new Date("2026-09-15T12:00:00.000Z") },
        { event: "acted_on", createdAt: new Date("2026-09-16T09:00:00.000Z") },
        { event: "sent", createdAt: new Date("2026-09-17T09:00:00.000Z"), opportunityId: "o1" },
        { event: "replied", createdAt: new Date("2026-09-18T09:00:00.000Z"), opportunityId: "o1" },
        { event: "replied", createdAt: new Date("2026-09-18T10:00:00.000Z"), opportunityId: "o2" },
        { event: "copy", createdAt: new Date("2026-09-17T09:30:00.000Z") },
        { event: "acted_on", createdAt: new Date("2026-09-10T09:00:00.000Z") }, // prior week
      ],
    });
    expect(stats.actedOnCount).toBe(3);
    expect(stats.usefulCount).toBe(2);
    expect(stats.notUsefulCount).toBe(1);
    expect(stats.precision).toBeCloseTo(2 / 3);
    expect(stats.actionRate).toBeCloseTo(0.3);
  });
});
