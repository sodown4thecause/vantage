import { describe, expect, it } from "vitest";

import { skippedSourcesNotice } from "@/lib/profile/skipped-sources";

const review = (accepted: boolean, reasons: string[]) => ({ accepted, score: 0.2, threshold: 0.5, matchedTerms: [], reasons, method: "terms" as const });

describe("skippedSourcesNotice", () => {
  it("is absent when the gate accepted the topics", () => {
    expect(skippedSourcesNotice(["syften alternative"], review(true, ["fine"]))).toBeUndefined();
  });

  it("names the skipped topics and the reason, and says what the owner can do", () => {
    const notice = skippedSourcesNotice(["ai", "startup", "tools"], review(false, ["Every query is generic and could match almost any product."]))!;
    expect(notice.topics).toEqual(["ai", "startup", "tools"]);
    expect(notice.reasons).toEqual(["Every query is generic and could match almost any product."]);
    expect(notice.message).toContain('"ai", "startup", "tools"');
    expect(notice.message).toContain("Every query is generic");
    expect(notice.message).toMatch(/Sources page/);
  });

  it("only names the topics the gate actually looked at (the first five)", () => {
    const notice = skippedSourcesNotice(["a1x", "b2x", "c3x", "d4x", "e5x", "f6x"], review(false, ["r"]))!;
    expect(notice.topics).toEqual(["a1x", "b2x", "c3x", "d4x", "e5x"]);
  });

  it("always gives a reason, even if the gate gave none", () => {
    expect(skippedSourcesNotice(["ai"], review(false, []))!.reasons.length).toBe(1);
  });
});
