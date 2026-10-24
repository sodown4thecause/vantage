import { describe, expect, it } from "vitest";

import { formatNextScan } from "@/lib/scan/next-scan";

// Sydney moves from AEST (+10) to AEDT (+11) at 2am on 4 October 2026; Brisbane stays on +10 all year.
describe("formatNextScan", () => {
  it("keeps the owner's wall-clock hour across the Sydney daylight-saving change", () => {
    expect(formatNextScan("2026-10-02T22:30:00.000Z", "Australia/Sydney")).toContain("8:30");
    expect(formatNextScan("2026-10-03T21:30:00.000Z", "Australia/Sydney")).toContain("8:30");
  });

  it("does not shift for Brisbane, which has no daylight saving", () => {
    expect(formatNextScan("2026-10-02T22:30:00.000Z", "Australia/Brisbane")).toContain("8:30");
    expect(formatNextScan("2026-10-03T22:30:00.000Z", "Australia/Brisbane")).toContain("8:30");
  });

  it("returns null for a zone the runtime does not know", () => {
    expect(formatNextScan("2026-10-02T22:30:00.000Z", "Not/AZone")).toBeNull();
  });
});
