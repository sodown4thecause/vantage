import { describe, expect, it } from "vitest";

import { nothingStrongReason, scanJustFinished } from "@/lib/scan/nothing-strong";

describe("nothingStrongReason", () => {
  it("blames sources when fewer than 50 documents were read, whatever the source count", () => {
    expect(nothingStrongReason(0)).toBe("few_sources");
    expect(nothingStrongReason(49)).toBe("few_sources");
  });

  it("blames topics once 50 or more documents were read", () => {
    expect(nothingStrongReason(50)).toBe("topics_too_narrow");
    expect(nothingStrongReason(600)).toBe("topics_too_narrow");
  });
});

describe("scanJustFinished", () => {
  it("is true only when this page saw the scan leave an active state", () => {
    expect(scanJustFinished(true, "done")).toBe(true);
    expect(scanJustFinished(true, "partial")).toBe(true);
    expect(scanJustFinished(true, "failed")).toBe(true);
  });

  it("is false for a page opened after the scan already completed, so it does not reload in a loop", () => {
    expect(scanJustFinished(false, "done")).toBe(false);
    expect(scanJustFinished(false, "partial")).toBe(false);
  });

  it("is false while the scan is still active", () => {
    expect(scanJustFinished(true, "running")).toBe(false);
    expect(scanJustFinished(true, "queued")).toBe(false);
  });
});
