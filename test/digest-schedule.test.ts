import { describe, expect, it } from "vitest";

import { clampHour, isDigestDue, latestDigestSlot, zonedHourToInstant } from "@/lib/digest/schedule";

describe("clampHour", () => {
  it("keeps hours inside 0-23", () => {
    expect(clampHour(0)).toBe(0);
    expect(clampHour(13)).toBe(13);
    expect(clampHour(23)).toBe(23);
    expect(clampHour(30)).toBe(23);
    expect(clampHour(-5)).toBe(0);
    expect(clampHour(Number.NaN)).toBe(13);
    expect(clampHour(13.9)).toBe(13);
  });
});

describe("isDigestDue", () => {
  const now = new Date("2026-10-09T14:30:00.000Z");

  it("is due for a never-sent workspace's latest elapsed slot", () => {
    expect(isDigestDue({ digestHourUtc: 13, lastSentAt: null, now })).toBe(true);
    expect(isDigestDue({ digestHourUtc: 15, lastSentAt: null, now })).toBe(true);
  });

  it("waits at least 20 hours between digests", () => {
    expect(
      isDigestDue({
        digestHourUtc: 0,
        lastSentAt: new Date("2026-10-09T10:00:00.000Z"),
        now,
      }),
    ).toBe(false);
    expect(
      isDigestDue({
        digestHourUtc: 0,
        lastSentAt: new Date("2026-10-08T10:00:00.000Z"),
        now,
      }),
    ).toBe(true);
  });

  it("catches up the 23 UTC slot at the next midnight", () => {
    expect(
      isDigestDue({
        digestHourUtc: 23,
        lastSentAt: new Date("2026-10-09T00:00:00.000Z"),
        now: new Date("2026-10-10T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("catches up a never-sent workspace's 23 UTC slot at midnight", () => {
    expect(
      isDigestDue({
        digestHourUtc: 23,
        lastSentAt: null,
        now: new Date("2026-10-10T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("does not send twice for a slot even after the minimum interval", () => {
    expect(
      isDigestDue({
        digestHourUtc: 0,
        lastSentAt: new Date("2026-10-09T00:00:00.000Z"),
        now: new Date("2026-10-09T21:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("requires the full 20-hour interval for an unsent slot", () => {
    const input = {
      digestHourUtc: 22,
      lastSentAt: new Date("2026-10-09T04:00:00.000Z"),
    };
    expect(
      isDigestDue({ ...input, now: new Date("2026-10-09T23:59:59.999Z") }),
    ).toBe(false);
    expect(
      isDigestDue({ ...input, now: new Date("2026-10-10T00:00:00.000Z") }),
    ).toBe(true);
  });

  it("catches up a late slot across a UTC month boundary", () => {
    expect(
      isDigestDue({
        digestHourUtc: 23,
        lastSentAt: new Date("2026-10-31T00:00:00.000Z"),
        now: new Date("2026-11-01T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("catches up an unsent prior slot while waiting for today's hour", () => {
    expect(
      isDigestDue({
        digestHourUtc: 14,
        lastSentAt: new Date("2026-10-08T20:00:00.000Z"),
        now: new Date("2026-10-09T13:59:00.000Z"),
      }),
    ).toBe(false);
    expect(
      isDigestDue({
        digestHourUtc: 14,
        lastSentAt: new Date("2026-10-08T10:00:00.000Z"),
        now: new Date("2026-10-09T13:59:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isDigestDue({
        digestHourUtc: 14,
        lastSentAt: new Date("2026-10-08T10:00:00.000Z"),
        now: new Date("2026-10-09T14:00:00.000Z"),
      }),
    ).toBe(true);
  });
});

describe("local digest hour in an IANA time zone", () => {
  // Sydney moves to daylight time at 2am on Sunday 4 October 2026 (UTC+10 to UTC+11). Brisbane stays on UTC+10.
  const iso = (date: Date) => date.toISOString();

  it("converts 8am to the right UTC instant on each side of Sydney's daylight-saving change", () => {
    expect(iso(zonedHourToInstant({ year: 2026, month: 10, day: 3 }, 8, "Australia/Sydney"))).toBe("2026-10-02T22:00:00.000Z");
    expect(iso(zonedHourToInstant({ year: 2026, month: 10, day: 4 }, 8, "Australia/Sydney"))).toBe("2026-10-03T21:00:00.000Z");
    expect(iso(zonedHourToInstant({ year: 2026, month: 10, day: 4 }, 8, "Australia/Brisbane"))).toBe("2026-10-03T22:00:00.000Z");
  });

  it("moves an hour skipped by the change forward, as clocks do", () => {
    expect(iso(zonedHourToInstant({ year: 2026, month: 10, day: 4 }, 2, "Australia/Sydney"))).toBe("2026-10-03T16:00:00.000Z");
  });

  it("sends Sydney at 8am local after the change, an hour earlier in UTC, while Brisbane keeps its UTC time", () => {
    const lastSentAt = new Date("2026-10-02T22:00:00.000Z"); // Saturday 8am in both cities.
    const now = new Date("2026-10-03T21:30:00.000Z"); // Sunday 8:30am Sydney, 7:30am Brisbane.
    expect(isDigestDue({ digestHourUtc: 22, digestLocalHour: 8, digestTimeZone: "Australia/Sydney", lastSentAt, now })).toBe(true);
    expect(isDigestDue({ digestHourUtc: 22, digestLocalHour: 8, digestTimeZone: "Australia/Brisbane", lastSentAt, now })).toBe(false);
    // The stored UTC hour alone would have waited until 9am Sydney time.
    expect(isDigestDue({ digestHourUtc: 22, lastSentAt, now })).toBe(false);
  });

  it("uses yesterday's local slot before today's hour arrives", () => {
    const now = new Date("2026-10-03T20:00:00.000Z"); // Sunday 7am Sydney.
    expect(iso(latestDigestSlot({ digestHourUtc: 0, digestLocalHour: 8, digestTimeZone: "Australia/Sydney", now }))).toBe("2026-10-02T22:00:00.000Z");
  });

  it("keeps the UTC hour for existing rows and for an unknown zone", () => {
    const now = new Date("2026-10-03T21:30:00.000Z");
    expect(iso(latestDigestSlot({ digestHourUtc: 13, now }))).toBe("2026-10-03T13:00:00.000Z");
    expect(iso(latestDigestSlot({ digestHourUtc: 13, digestLocalHour: 8, digestTimeZone: "Not/AZone", now }))).toBe("2026-10-03T13:00:00.000Z");
    expect(iso(latestDigestSlot({ digestHourUtc: 13, digestLocalHour: 8, digestTimeZone: null, now }))).toBe("2026-10-03T13:00:00.000Z");
  });
});
