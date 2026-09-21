import { describe, expect, it } from "vitest";

import {
  assertCopyAllowed,
  flagUnsupportedClaims,
  generateGroundedDraft,
} from "../lib/drafting/generate";

describe("grounded drafting", () => {
  it("produces a draft with citations from evidence", () => {
    const draft = generateGroundedDraft({
      productDescription: "Vantage helps founders find high-intent conversations.",
      targetCustomer: "solo B2B founders",
      productMaterialText: "We monitor Reddit and HN for buying intent.",
      opportunityTitle: "Looking for social listening tools",
      opportunitySummary: "Founders asking for recommendations",
      recommendedAction: "Draft a grounded reply",
      evidence: [
        {
          documentId: "d1",
          title: "Recommend a tool?",
          urlCanonical: "https://reddit.com/r/saas/1",
          contentMd: "Looking for a social listening tool to buy",
          platform: "reddit",
        },
      ],
    });
    expect(draft.originalText).toMatch(/Vantage|product notes|founders/i);
    expect(draft.citations).toHaveLength(1);
    expect(draft.citations[0]?.url).toContain("reddit.com");
  });

  it("flags and softens unsupported absolute claims", () => {
    const flags = flagUnsupportedClaims("We are the best in the world solution");
    expect(flags.length).toBeGreaterThan(0);
    const draft = generateGroundedDraft({
      productDescription: "guaranteed #1 results always",
      targetCustomer: "teams",
      productMaterialText: "guaranteed best in the world outcomes",
      opportunityTitle: "t",
      opportunitySummary: "s",
      recommendedAction: "a",
      evidence: [],
    });
    expect(draft.originalText.toLowerCase()).not.toMatch(/guaranteed/);
  });

  it("blocks copy when edited text reintroduces bad claims", () => {
    const blocked = assertCopyAllowed({
      editedText: "This is guaranteed to work",
      flags: [],
    });
    expect(blocked.ok).toBe(false);
    const ok = assertCopyAllowed({
      editedText: "Happy to share how we approach this.",
      flags: [],
    });
    expect(ok.ok).toBe(true);
  });
});
