import { describe, expect, it } from "vitest";

import {
  SOURCE_RELEVANCE_THRESHOLD,
  reviewSourceProposal,
  type ReviewProfile,
  type SourceProposal,
} from "@/lib/agents/discovery";

const profile: ReviewProfile = {
  productName: "Vantage",
  description: "Finds the conversations where developers ask for tools like yours.",
  category: "Go-to-market tooling for AI developer products",
  audience: "Founders of AI developer tools",
  differentiators: ["Scores buying intent", "Owner writes every reply"],
  competitors: ["syften.com", "f5bot.com"],
  keywords: ["developer tool marketing", "syften alternative"],
};

const source = (over: Partial<SourceProposal>): SourceProposal => ({
  sourceType: "hn", name: "Profile: Hacker News", queries: ["x"], rationale: "r", relevanceScore: 0.9, ...over,
});

describe("source quality gate", () => {
  it("rejects the 25 Oct HN profile source at proposal time, even when the model claims 0.9", () => {
    // The noisy source searched broad topics that say nothing about this product.
    const review = reviewSourceProposal(profile, source({ queries: ["ai", "startup", "automation", "tools", "show hn"] }));
    expect(review.accepted).toBe(false);
    expect(review.score).toBeLessThan(SOURCE_RELEVANCE_THRESHOLD);
    expect(review.reasons.join(" ")).toMatch(/generic|no query/i);
  });

  it("rejects a source whose queries share nothing with the profile", () => {
    const review = reviewSourceProposal(profile, source({ queries: ["rust borrow checker", "kubernetes operators"] }));
    expect(review.accepted).toBe(false);
  });

  it("accepts a specific source and keeps the matched terms for the owner to read", () => {
    const review = reviewSourceProposal(profile, source({
      name: "HN: developer tool marketing", queries: ["developer tool marketing", "syften alternative"], relevanceScore: 0.8,
    }));
    expect(review.accepted).toBe(true);
    expect(review.score).toBeGreaterThanOrEqual(SOURCE_RELEVANCE_THRESHOLD);
    expect(review.matchedTerms.length).toBeGreaterThan(0);
  });

  it("rejects when the model itself scores a source below the threshold", () => {
    const review = reviewSourceProposal(profile, source({ queries: ["developer tool marketing"], relevanceScore: 0.2 }));
    expect(review.accepted).toBe(false);
    expect(review.reasons.join(" ")).toMatch(/model/i);
  });

  it("rejects a source when any one query is generic, even if the others name the product and the model is confident", () => {
    const review = reviewSourceProposal(profile, source({ queries: ["syften alternative", "ai"], relevanceScore: 0.9 }));
    expect(review.accepted).toBe(false);
    expect(review.reasons.join(" ")).toMatch(/"ai"/);
  });

  it("treats a single query that matches as enough only if the others are not generic noise", () => {
    const review = reviewSourceProposal(profile, source({ queries: ["developer tool marketing", "ai", "startup", "tools"], relevanceScore: 0.9 }));
    expect(review.accepted).toBe(false);
  });
});
