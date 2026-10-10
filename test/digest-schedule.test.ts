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

  it("is due for a never-sent workspace after its hour", () => {
    expect(isDigestDue({ digestHourUtc: 13, lastSentAt: null, now })).toBe(true);
    expect(isDigestDue({ digestHourUtc: 15, lastSentAt: null, now })).toBe(false);
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

  it("becomes due once the hour passes and 20h have elapsed", () => {
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
    ).toBe(false);
    expect(
      isDigestDue({
        digestHourUtc: 14,
        lastSentAt: new Date("2026-10-08T10:00:00.000Z"),
        now: new Date("2026-10-09T14:01:00.000Z"),
      }),
    ).toBe(true);
  });
});
