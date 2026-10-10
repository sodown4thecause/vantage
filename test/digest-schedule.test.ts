import { describe, expect, it } from "vitest";

import { clampHour, isDigestDue } from "@/lib/digest/schedule";

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
