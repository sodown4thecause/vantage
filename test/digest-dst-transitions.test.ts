import { describe, expect, it } from "vitest";

import { isDigestDue, latestDigestSlot, zonedHourToInstant } from "@/lib/digest/schedule";

describe("digest DST conversion matches PostgreSQL AT TIME ZONE", () => {
  it.each([
    ["America/New_York", 3, 8, 2, "2026-03-08T07:00:00.000Z"],
    ["America/New_York", 11, 1, 1, "2026-11-01T06:00:00.000Z"],
    ["Australia/Sydney", 10, 4, 2, "2026-10-03T16:00:00.000Z"],
    ["Australia/Sydney", 4, 5, 2, "2026-04-04T16:00:00.000Z"],
    ["Australia/Lord_Howe", 10, 4, 2, "2026-10-03T15:30:00.000Z"],
    ["Australia/Lord_Howe", 4, 5, 2, "2026-04-04T15:30:00.000Z"],
  ])("resolves %s on %i/%i at %i:00 to %s", (zone, month, day, hour, expected) => {
    expect(zonedHourToInstant({ year: 2026, month, day }, hour, zone).toISOString()).toBe(expected);
  });

  it.each([
    [3, 8, 2, "2026-03-07T07:00:00.000Z", "2026-03-08T07:00:00.000Z"],
    [11, 1, 1, "2026-10-31T05:00:00.000Z", "2026-11-01T06:00:00.000Z"],
  ])("waits until the PostgreSQL slot on %i/%i at %i:00", (_month, _day, hour, previous, slot) => {
    const input = { digestHourUtc: 0, digestLocalHour: hour, digestTimeZone: "America/New_York" };
    const before = new Date(new Date(slot).getTime() - 1);
    expect(latestDigestSlot({ ...input, now: before }).toISOString()).toBe(previous);
    expect(isDigestDue({ ...input, now: before, lastSentAt: new Date(previous) })).toBe(false);
    expect(latestDigestSlot({ ...input, now: new Date(slot) }).toISOString()).toBe(slot);
    expect(isDigestDue({ ...input, now: new Date(slot), lastSentAt: new Date(previous) })).toBe(true);
    expect(isDigestDue({ ...input, now: new Date(slot), lastSentAt: new Date(slot) })).toBe(false);
  });
});
