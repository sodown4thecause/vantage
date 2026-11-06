import { describe, expect, it } from "vitest";

import {
  competitorProposalSchema,
  keywordProposalSchema,
  profileProposalSchema,
  proposalToolResultSchema,
  sourceProposalSchema,
} from "@/lib/agents/discovery";

const profile = {
  productName: "Vantage",
  description: "Finds the conversations where developers ask for tools like yours.",
  category: "Go-to-market tooling for AI developer products",
  audience: "Founders of AI developer tools",
  pricingTier: "paid",
  differentiators: ["Owner writes every reply", "Scores buying intent"],
  evidenceUrl: "https://contextfor.dev/",
} as const;

describe("proposal shapes", () => {
  it("accepts a well-formed profile proposal and rejects unknown keys", () => {
    expect(profileProposalSchema.parse(profile)).toMatchObject({ productName: "Vantage" });
    expect(profileProposalSchema.safeParse({ ...profile, extra: 1 }).success).toBe(false);
  });

  it("requires a pricing tier from the fixed list and a public evidence link", () => {
    expect(profileProposalSchema.safeParse({ ...profile, pricingTier: "cheap" }).success).toBe(false);
    expect(profileProposalSchema.safeParse({ ...profile, evidenceUrl: "http://localhost/x" }).success).toBe(false);
  });

  it("normalises competitor domains and needs positioning and evidence", () => {
    const parsed = competitorProposalSchema.parse({
      domain: "WWW.Example.com", positioning: "Alerts for Reddit mentions.", evidenceUrl: "https://example.com/about",
    });
    expect(parsed.domain).toBe("example.com");
    expect(competitorProposalSchema.safeParse({ domain: "not a domain", positioning: "x", evidenceUrl: "https://example.com" }).success).toBe(false);
  });

  it("keeps keyword kinds to product, competitor and category", () => {
    const base = { keyword: "reddit lead alternative", rationale: "Buyers compare tools.", evidenceUrl: "https://example.com/p" };
    expect(keywordProposalSchema.parse({ ...base, kind: "competitor" }).kind).toBe("competitor");
    expect(keywordProposalSchema.safeParse({ ...base, kind: "other" }).success).toBe(false);
  });

  it("caps source queries and the model-claimed score", () => {
    const base = { sourceType: "hn", name: "HN: AI dev tool launches", queries: ["ai dev tool launch"], rationale: "Launch threads.", relevanceScore: 0.8 };
    expect(sourceProposalSchema.parse(base).queries).toHaveLength(1);
    expect(sourceProposalSchema.safeParse({ ...base, queries: [] }).success).toBe(false);
    expect(sourceProposalSchema.safeParse({ ...base, relevanceScore: 1.5 }).success).toBe(false);
    expect(sourceProposalSchema.safeParse({ ...base, sourceType: "twitter" }).success).toBe(false);
  });

  it("describes each tool result so a UI can switch on kind and status", () => {
    const ok = proposalToolResultSchema.parse({ kind: "profile", status: "proposed", proposal: profile });
    expect(ok.kind).toBe("profile");
    expect(proposalToolResultSchema.safeParse({ kind: "source", status: "proposed", proposal: profile }).success).toBe(false);
  });
});
