import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import {
  createRelevanceJudge,
  gateSource,
  type RelevanceJudge,
  type ReviewProfile,
  type SourceProposal,
} from "@/lib/agents/discovery";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

vi.mock("@/lib/db/client", () => ({ getDb: () => { throw new Error("the relevance gate must not touch the database"); } }));

const usage = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 200, text: 200, reasoning: 0 },
};
const COST = (1000 * 2 + 200 * 10) / 1_000_000; // anthropic/claude-sonnet-5.5 price table

const profile: ReviewProfile = {
  productName: "Vantage",
  description: "Finds the conversations where developers ask for tools like yours.",
  category: "Go-to-market tooling for AI developer products",
  audience: "Founders of AI developer tools",
  differentiators: ["Owner writes every reply", "Scores buying intent"],
  competitors: ["syften.com"],
  keywords: ["syften alternative"],
};

const hn = (queries: string[], relevanceScore = 0.9, name = "Profile: Hacker News"): SourceProposal =>
  ({ sourceType: "hn", name, queries, rationale: "Founders hang out here.", relevanceScore });

const modelReturning = (judgements: Array<{ query: string; fit: number; rung: number; situation?: string; why?: string }>) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify({ queries: judgements.map((j) => ({ situation: "other", why: "mock", ...j })) }) }],
      finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [],
    } as never,
  });

function judgeFor(model: MockLanguageModelV4) {
  const meta: Array<Record<string, unknown>> = [];
  const judge = createRelevanceJudge({
    model, modelId: "anthropic/claude-sonnet-5.5", workspaceId: "ws", sourceKey: "discovery",
    runPaidCall: (async (m: Record<string, unknown>, work: () => Promise<{ value?: unknown; costUsd?: number }>) => {
      meta.push(m);
      const out = await work();
      meta.push({ costUsd: out.costUsd });
      return out.value;
    }) as never,
  });
  return { judge, meta };
}

describe("createRelevanceJudge", () => {
  it("asks the model about every query through runPaidCall on the gateway, using the pipeline's rungs, situations and anchors", async () => {
    const model = modelReturning([{ query: "syften alternative", fit: 0.9, rung: 3, situation: "alternative_request" }]);
    const { judge, meta } = judgeFor(model);
    const result = await judge(profile, hn(["syften alternative"]));

    expect(result.judgements).toEqual([expect.objectContaining({ query: "syften alternative", fit: 0.9, rung: 3, situation: "alternative_request" })]);
    expect(meta[0]).toMatchObject({ provider: "gateway", action: "discovery_relevance", context: { workspaceId: "ws", sourceKey: "discovery" } });
    expect(result.costUsd).toBeCloseTo(COST, 6);
    expect(meta[1]!.costUsd).toBeCloseTo(COST, 6);

    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    for (const expected of ["comparison", "purchase/recommend", "alternative_request", "migration", "Vantage", "syften alternative", "Brand24 vs Mention"]) {
      expect(prompt).toContain(expected);
    }
  });
});

describe("gateSource", () => {
  const sycophant = () => modelReturning([{ query: "ai", fit: 0.95, rung: 4 }, { query: "startup", fit: 0.95, rung: 4 }, { query: "tools", fit: 0.95, rung: 4 }]);

  it("REGRESSION 25 Oct: rejects the broad HN profile source on term match alone, without spending on the model", async () => {
    const model = sycophant();
    const { judge } = judgeFor(model);
    const review = await gateSource(profile, hn(["ai", "startup", "tools"], 0.9), { judge });
    expect(review.accepted).toBe(false);
    expect(review.reasons.join(" ")).toMatch(/generic/i);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("rejects a source whose queries pass the term pre-filter but which the model judges unrelated to the product", async () => {
    const model = modelReturning([
      { query: "vantage point photography", fit: 0.08, rung: 0, why: "About camera angles, not developer tooling." },
      { query: "vantage tours", fit: 0.05, rung: 0, why: "Travel." },
    ]);
    const { judge } = judgeFor(model);
    const review = await gateSource(profile, hn(["vantage point photography", "vantage tours"], 0.95), { judge });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(review.accepted).toBe(false);
    expect(review.method).toBe("ai");
    expect(review.reasons.join(" ")).toContain("About camera angles");
  });

  it("does not let the proposing model's own score override the relevance review", async () => {
    const { judge } = judgeFor(modelReturning([{ query: "vantage tours", fit: 0.1, rung: 0 }]));
    const review = await gateSource(profile, hn(["vantage tours"], 1), { judge });
    expect(review.accepted).toBe(false);
    expect(review.score).toBeLessThan(0.5);
  });

  it("accepts a source the review finds relevant, scoring it from fit and intent rung", async () => {
    const { judge } = judgeFor(modelReturning([
      { query: "syften alternative", fit: 0.9, rung: 3 },
      { query: "vantage reddit monitoring", fit: 0.8, rung: 2 },
    ]));
    const review = await gateSource(profile, hn(["syften alternative", "vantage reddit monitoring"], 0.2, "HN: syften"), { judge });
    expect(review.accepted).toBe(true);
    expect(review.method).toBe("ai");
    expect(review.score).toBeGreaterThanOrEqual(0.5);
    expect(review.matchedTerms).toContain("syften");
  });

  it("rejects a source when any one query does not fit, even if the others fit strongly", async () => {
    const judge = vi.fn(async (_p: unknown, source: { queries: string[] }) => ({
      judgements: source.queries.map((query, i) => ({ query, fit: i === 0 ? 0.95 : 0.1, rung: 4, situation: "other", why: "mock" })), costUsd: 0.004,
    }));
    const review = await gateSource(profile, hn(["syften alternative", "developer tool marketing"], 0.9, "HN: two"), { judge: judge as never });
    expect(review.accepted).toBe(false);
    expect(review.method).toBe("ai");
  });

  it("rejects when fewer than half the queries fit, even if one fits strongly", async () => {
    const { judge } = judgeFor(modelReturning([
      { query: "syften alternative", fit: 1, rung: 4 },
      { query: "vantage tours", fit: 0.1, rung: 0 },
      { query: "vantage photos", fit: 0.1, rung: 0 },
    ]));
    const review = await gateSource(profile, hn(["syften alternative", "vantage tours", "vantage photos"]), { judge });
    expect(review.accepted).toBe(false);
  });

  it("falls back to the term match alone, and says so, when there is no budget for a review", async () => {
    const model = modelReturning([{ query: "syften alternative", fit: 0, rung: 0 }]);
    const { judge } = judgeFor(model);
    const review = await gateSource(profile, hn(["syften alternative"]), { judge, canAfford: () => false });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(review.accepted).toBe(true);
    expect(review.method).toBe("terms");
    expect(review.reasons.join(" ")).toMatch(/budget/i);
  });

  it("still rejects broad queries when the budget is spent", async () => {
    const review = await gateSource(profile, hn(["ai", "startup"]), { canAfford: () => false });
    expect(review.accepted).toBe(false);
  });

  it("falls back to the term match when the review call is denied or fails", async () => {
    for (const error of [new PaidCallDeniedError("budget_exhausted", "cap"), new Error("gateway down")]) {
      const judge: RelevanceJudge = async () => { throw error; };
      const review = await gateSource(profile, hn(["syften alternative"]), { judge });
      expect(review).toMatchObject({ accepted: true, method: "terms" });
    }
  });

  it("reports what the review cost so the run can count it", async () => {
    const onCost = vi.fn();
    const { judge } = judgeFor(modelReturning([{ query: "syften alternative", fit: 0.9, rung: 3 }]));
    await gateSource(profile, hn(["syften alternative"]), { judge, onCost });
    expect(onCost).toHaveBeenCalledWith(expect.closeTo(COST, 6));
  });
});
