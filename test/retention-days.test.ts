import { describe, expect, it } from "vitest";

import { localDay, previousDay, safeTimeZone, startOfLocalMonth } from "@/lib/retention/days";

describe("retention days", () => {
  it("names the local calendar day in the workspace time zone", () => {
    const at = new Date("2026-10-23T20:30:00Z");
    expect(localDay(at, "UTC")).toBe("2026-10-23");
    expect(localDay(at, "Australia/Sydney")).toBe("2026-10-24");
    expect(localDay(at, "America/Los_Angeles")).toBe("2026-10-23");
  });

  it("steps back one calendar day across month and year ends", () => {
    expect(previousDay("2026-10-24")).toBe("2026-10-23");
    expect(previousDay("2026-11-01")).toBe("2026-10-31");
    expect(previousDay("2027-01-01")).toBe("2026-12-31");
    expect(previousDay("2028-03-01")).toBe("2028-02-29");
  });

  it("falls back to UTC for a missing or unknown time zone", () => {
    expect(safeTimeZone(null)).toBe("UTC");
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(safeTimeZone("Australia/Sydney")).toBe("Australia/Sydney");
  });

  it("finds the start of the local month, including across a daylight-saving change", () => {
    expect(startOfLocalMonth(new Date("2026-10-24T05:00:00Z"), "UTC").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(startOfLocalMonth(new Date("2026-10-24T05:00:00Z"), "Australia/Sydney").toISOString()).toBe("2026-09-30T14:00:00.000Z");
    expect(startOfLocalMonth(new Date("2026-10-31T14:00:00Z"), "Australia/Sydney").toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(startOfLocalMonth(new Date("2026-04-10T05:00:00Z"), "Australia/Sydney").toISOString()).toBe("2026-03-31T13:00:00.000Z");
    expect(startOfLocalMonth(new Date("2026-11-15T05:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-11-01T07:00:00.000Z");
  });
});
