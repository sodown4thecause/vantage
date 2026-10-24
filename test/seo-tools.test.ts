import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  peekDataForSeo: vi.fn(),
  resolveLlmModel: vi.fn(),
  fetchBacklinkSummary: vi.fn(),
  fetchReferringDomains: vi.fn(),
  fetchAnchors: vi.fn(),
  fetchKeywordIdeas: vi.fn(),
  fetchKeywordOverview: vi.fn(),
  fetchRankedKeywords: vi.fn(),
  fetchCompetitorDomains: vi.fn(),
  fetchKeywordGap: vi.fn(),
  peekKeywordIdeas: vi.fn(),
  peekKeywordOverview: vi.fn(),
  peekRankedKeywords: vi.fn(),
  peekCompetitorDomains: vi.fn(),
  peekKeywordGap: vi.fn(),
  fetchGoogleSerp: vi.fn(),
  peekGoogleSerp: vi.fn(),
  fetchLlmResponse: vi.fn(),
  peekLlmResponse: vi.fn(),
  fetchAiKeywordVolume: vi.fn(),
  peekAiKeywordVolume: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

vi.mock("@/lib/dataforseo/gate", () => {
  class DataForSeoDeniedError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "DataForSeoDeniedError";
    }
  }
  return {
    DataForSeoDeniedError,
    peekDataForSeo: mocks.peekDataForSeo,
    runDataForSeo: vi.fn(),
    listLlmModels: vi.fn(async () => []),
  };
});

vi.mock("@/lib/providers/paid-call", () => {
  class PaidCallDeniedError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "PaidCallDeniedError";
    }
  }
  return { PaidCallDeniedError };
});

vi.mock("@/lib/dataforseo/backlinks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataforseo/backlinks")>()),
  fetchBacklinkSummary: mocks.fetchBacklinkSummary,
  fetchReferringDomains: mocks.fetchReferringDomains,
  fetchAnchors: mocks.fetchAnchors,
}));

vi.mock("@/lib/dataforseo/labs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataforseo/labs")>()),
  fetchKeywordIdeas: mocks.fetchKeywordIdeas,
  fetchKeywordOverview: mocks.fetchKeywordOverview,
  fetchRankedKeywords: mocks.fetchRankedKeywords,
  fetchCompetitorDomains: mocks.fetchCompetitorDomains,
  fetchKeywordGap: mocks.fetchKeywordGap,
  peekKeywordIdeas: mocks.peekKeywordIdeas,
  peekKeywordOverview: mocks.peekKeywordOverview,
  peekRankedKeywords: mocks.peekRankedKeywords,
  peekCompetitorDomains: mocks.peekCompetitorDomains,
  peekKeywordGap: mocks.peekKeywordGap,
}));

vi.mock("@/lib/dataforseo/serp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataforseo/serp")>()),
  fetchGoogleSerp: mocks.fetchGoogleSerp,
  peekGoogleSerp: mocks.peekGoogleSerp,
}));

vi.mock("@/lib/dataforseo/ai-optimization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataforseo/ai-optimization")>()),
  resolveLlmModel: mocks.resolveLlmModel,
  fetchLlmResponse: mocks.fetchLlmResponse,
  peekLlmResponse: mocks.peekLlmResponse,
  fetchAiKeywordVolume: mocks.fetchAiKeywordVolume,
  peekAiKeywordVolume: mocks.peekAiKeywordVolume,
}));

import { DataForSeoDeniedError } from "@/lib/dataforseo/gate";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";
import { QuestionBudget, autoCreditsFromEnv, geoAlwaysAsk } from "@/lib/seo-agent/budget";
import { toolsForIntent } from "@/lib/seo-agent/tools";
import { addCard, type ToolContext } from "@/lib/seo-agent/tools/shared";

type Runnable = { execute: (input: unknown, options: unknown) => Promise<unknown>; strict?: boolean; inputSchema: unknown };

const WORKSPACE = "ws_test";
const ALL_ENGINES = ["chat_gpt", "claude", "gemini", "perplexity"];
const DATAFORSEO_PAUSED = "SEO lookups are paused. Try again later.";
const CREDITS_EXHAUSTED = "You have used this month's SEO credits. They reset on the 1st (UTC); Pro includes more.";

const summary = {
  target: "example.com",
  rank: 100,
  backlinks: 10,
  referringDomains: 5,
  referringMainDomains: 4,
  brokenBacklinks: 0,
  spamScore: 1,
  firstSeen: null,
};

const ownDomains = [{ domain: "a.com", rank: 10, backlinks: 1, spamScore: 0, firstSeen: null }];
const rivalDomains = [
  { domain: "a.com", rank: 10, backlinks: 1, spamScore: 0, firstSeen: null },
  { domain: "b.com", rank: 50, backlinks: 3, spamScore: 0, firstSeen: null },
  { domain: "example.com", rank: 99, backlinks: 2, spamScore: 0, firstSeen: null },
  { domain: "c.com", rank: 20, backlinks: 1, spamScore: 0, firstSeen: null },
];

const answer = {
  engine: "claude",
  model: "model-x",
  text: "Try Example Tool.",
  citations: [{ title: null, url: "https://example.com/tool" }],
  mentionsBrand: true,
};

function makeCtx(budget = new QuestionBudget(3)): ToolContext {
  return { workspaceId: WORKSPACE, budget, brandDomains: ["example.com"], cards: [], notices: [] };
}

function toolsFor(intent: Parameters<typeof toolsForIntent>[0], ctx: ToolContext): Record<string, Runnable> {
  return toolsForIntent(intent, ctx) as unknown as Record<string, Runnable>;
}

function run(tools: Record<string, Runnable>, name: string, input: unknown): Promise<unknown> {
  return tools[name]!.execute(input, { toolCallId: "call", messages: [] });
}

const envKeys = ["SEO_AGENT_GEO_ALWAYS_ASK", "SEO_AGENT_AUTO_CREDITS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.peekDataForSeo.mockResolvedValue(null);
  mocks.resolveLlmModel.mockResolvedValue("model-x");
  mocks.fetchBacklinkSummary.mockResolvedValue({ value: summary, cached: false });
  mocks.fetchReferringDomains.mockResolvedValue({ value: [], cached: false });
  mocks.fetchAnchors.mockResolvedValue({ value: [], cached: false });
  for (const name of ["fetchKeywordIdeas", "fetchKeywordOverview", "fetchRankedKeywords", "fetchCompetitorDomains", "fetchKeywordGap", "fetchGoogleSerp", "fetchAiKeywordVolume"] as const) {
    mocks[name].mockResolvedValue({ value: [], cached: false });
  }
  for (const name of ["peekKeywordIdeas", "peekKeywordOverview", "peekRankedKeywords", "peekCompetitorDomains", "peekKeywordGap", "peekGoogleSerp", "peekLlmResponse", "peekAiKeywordVolume"] as const) {
    mocks[name].mockResolvedValue(null);
  }
  mocks.fetchLlmResponse.mockResolvedValue({ value: answer, cached: false });
});

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("QuestionBudget", () => {
  const call = (credits: number, input: Record<string, unknown> = {}) => ({ tool: "keyword_ideas", input, credits });

  it("lets credits through up to the auto limit, then asks for the next one", () => {
    const budget = new QuestionBudget(3);
    expect([budget.tryReserve(call(1), false), budget.tryReserve(call(1), false), budget.tryReserve(call(1), false)]).toEqual(["go", "go", "go"]);
    expect(budget.tryReserve(call(1), false)).toBe("ask");
    expect(budget.spent).toBe(3);
    expect(budget.planned).toEqual([call(1)]);
  });

  it("runs an approved call even when it is over budget, and only once", () => {
    const approved = call(2, { keywords: ["crm"] });
    const budget = new QuestionBudget(0, [approved]);
    expect(budget.tryReserve(call(2, { keywords: ["crm"] }), false)).toBe("go");
    expect(budget.spent).toBe(2);
    expect(budget.tryReserve(call(2, { keywords: ["crm"] }), false)).toBe("ask");
  });

  it("matches an approved call whatever the order of its input keys", () => {
    const budget = new QuestionBudget(0, [call(1, { domain: "example.com", competitor: "rival.io" })]);
    expect(budget.tryReserve(call(1, { competitor: "rival.io", domain: "example.com" }), false)).toBe("go");
  });

  it("asks again when an approved call now costs more credits than the owner approved", () => {
    const budget = new QuestionBudget(0, [call(1, { domain: "example.com", competitor: "rival.io" })]);
    expect(budget.tryReserve(call(2, { domain: "example.com", competitor: "rival.io" }), false)).toBe("ask");
    expect(budget.spent).toBe(0);
    expect(budget.planned).toEqual([call(2, { domain: "example.com", competitor: "rival.io" })]);
  });

  it("runs an approved call that now costs fewer credits than approved", () => {
    const budget = new QuestionBudget(0, [call(2, { domain: "example.com", competitor: "rival.io" })]);
    expect(budget.tryReserve(call(1, { domain: "example.com", competitor: "rival.io" }), false)).toBe("go");
    expect(budget.spent).toBe(1);
  });

  it("does not match an approved call with different input", () => {
    const budget = new QuestionBudget(0, [call(1, { keywords: ["crm"] })]);
    expect(budget.tryReserve(call(1, { keywords: ["erp"] }), false)).toBe("ask");
  });

  it("lowers spent on refund and never goes below zero", () => {
    const budget = new QuestionBudget(3);
    budget.tryReserve(call(2), false);
    budget.refund(1);
    expect(budget.spent).toBe(1);
    budget.refund(5);
    expect(budget.spent).toBe(0);
  });

  it("always asks when alwaysAsk is set, even within budget, unless approved", () => {
    const budget = new QuestionBudget(10, [call(2, { prompt: "p" })]);
    expect(budget.tryReserve(call(2, { prompt: "q" }), true)).toBe("ask");
    expect(budget.tryReserve(call(2, { prompt: "p" }), true)).toBe("go");
    expect(budget.spent).toBe(2);
  });

  it("records an identical planned call once", () => {
    const budget = new QuestionBudget(0);
    budget.tryReserve(call(1, { keywords: ["crm"] }), false);
    budget.tryReserve(call(1, { keywords: ["crm"] }), false);
    expect(budget.planned).toHaveLength(1);
  });
});

describe("budget environment helpers", () => {
  it("reads the auto credit limit, defaulting to 3", () => {
    expect(autoCreditsFromEnv({})).toBe(3);
    expect(autoCreditsFromEnv({ SEO_AGENT_AUTO_CREDITS: "5" })).toBe(5);
    expect(autoCreditsFromEnv({ SEO_AGENT_AUTO_CREDITS: "" })).toBe(3);
    expect(autoCreditsFromEnv({ SEO_AGENT_AUTO_CREDITS: "lots" })).toBe(3);
    expect(autoCreditsFromEnv({ SEO_AGENT_AUTO_CREDITS: "-2" })).toBe(3);
  });

  it("keeps GEO always-ask on unless the flag is exactly false", () => {
    expect(geoAlwaysAsk({})).toBe(true);
    expect(geoAlwaysAsk({ SEO_AGENT_GEO_ALWAYS_ASK: "true" })).toBe(true);
    expect(geoAlwaysAsk({ SEO_AGENT_GEO_ALWAYS_ASK: "false" })).toBe(false);
    expect(geoAlwaysAsk({ SEO_AGENT_GEO_ALWAYS_ASK: "FALSE" })).toBe(true);
  });
});

describe("tool gating", () => {
  it("rejects a non-domain before reserving anything", async () => {
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "localhost" });
    expect(result).toEqual({ error: "invalid_domain" });
    expect(ctx.budget.spent).toBe(0);
    expect(ctx.budget.planned).toEqual([]);
    expect(mocks.fetchBacklinkSummary).not.toHaveBeenCalled();
  });

  it("serves a cache hit as a cached card with no reservation", async () => {
    mocks.peekDataForSeo.mockImplementation(async (endpoint: string) => (endpoint === "/v3/backlinks/summary/live" ? summary : null));
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "example.com" });
    expect(result).toEqual({ source: "cached", data: summary });
    expect(ctx.cards).toEqual([{ tool: "backlink_summary", title: expect.any(String), fetchedAt: null, cached: true, data: summary, sandbox: true }]);
    expect(ctx.budget.spent).toBe(0);
    expect(mocks.fetchBacklinkSummary).not.toHaveBeenCalled();
  });

  it("returns needs_approval without fetching when the call is over budget", async () => {
    const ctx = makeCtx(new QuestionBudget(0));
    const result = await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "example.com" });
    expect(result).toEqual({ status: "needs_approval", credits: 1 });
    expect(mocks.fetchBacklinkSummary).not.toHaveBeenCalled();
    expect(ctx.cards).toEqual([]);
    expect(ctx.budget.planned).toEqual([{ tool: "backlink_summary", input: { domain: "example.com" }, credits: 1 }]);
  });

  it("normalises the domain before fetching and planning", async () => {
    const ctx = makeCtx(new QuestionBudget(0));
    await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "https://www.Example.com/page" });
    expect(ctx.budget.planned[0]?.input).toEqual({ domain: "example.com" });
  });

  it("labels a card with the environment that produced it", async () => {
    vi.stubEnv("DATAFORSEO_LOGIN", "login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "password");
    vi.stubEnv("DATAFORSEO_ENV", "live");
    const ctx = makeCtx();
    addCard(ctx, { tool: "keyword_ideas", title: "Ideas", cached: false, data: [] });
    expect(ctx.cards[0]?.sandbox).toBe(false);
    vi.stubEnv("DATAFORSEO_ENV", "sandbox");
    addCard(ctx, { tool: "keyword_ideas", title: "Ideas", cached: false, data: [] });
    expect(ctx.cards[1]?.sandbox).toBe(true);
    vi.unstubAllEnvs();
  });

  it("matches an approved plan by its normalised input", async () => {
    const ctx = makeCtx(new QuestionBudget(0, [{ tool: "backlink_summary", input: { domain: "example.com" }, credits: 1 }]));
    const result = await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "EXAMPLE.com" });
    expect(result).toEqual({ source: "live", data: summary });
    expect(mocks.fetchBacklinkSummary).toHaveBeenCalledWith(WORKSPACE, "example.com", expect.anything());
    expect(ctx.budget.spent).toBe(1);
  });

  it("stores a fresh fetch as an uncached card and spends the credit", async () => {
    const ctx = makeCtx(new QuestionBudget(3));
    await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "example.com" });
    expect(ctx.cards).toHaveLength(1);
    expect(ctx.cards[0]).toMatchObject({ tool: "backlink_summary", cached: false });
    expect(typeof ctx.cards[0]?.fetchedAt).toBe("string");
    expect(ctx.budget.spent).toBe(1);
  });

  it("refunds and adds the credits-exhausted notice on a gate denial", async () => {
    mocks.fetchBacklinkSummary.mockRejectedValue(new DataForSeoDeniedError("credits_exhausted", "No SEO credits are left this month."));
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "example.com" });
    expect(result).toEqual({ error: "credits_exhausted" });
    expect(ctx.budget.spent).toBe(0);
    expect(ctx.notices).toEqual([CREDITS_EXHAUSTED]);
    expect(ctx.cards).toEqual([]);
  });

  it("uses the paused notice for other gate denials", async () => {
    mocks.fetchBacklinkSummary.mockRejectedValue(new DataForSeoDeniedError("daily_cap", "The daily DataForSEO budget is used up."));
    const ctx = makeCtx(new QuestionBudget(3));
    expect(await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "example.com" })).toEqual({ error: "daily_cap" });
    expect(ctx.notices).toEqual([DATAFORSEO_PAUSED]);
    expect(ctx.budget.spent).toBe(0);
  });

  it("refunds and pauses on a paid-call denial", async () => {
    mocks.fetchBacklinkSummary.mockRejectedValue(new PaidCallDeniedError("budget_exhausted", "An explicit positive provider budget and estimate are required."));
    const ctx = makeCtx(new QuestionBudget(3));
    expect(await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "example.com" })).toEqual({ error: "budget_exhausted" });
    expect(ctx.notices).toEqual([DATAFORSEO_PAUSED]);
    expect(ctx.budget.spent).toBe(0);
  });

  it("refunds an unexpected error without adding a notice", async () => {
    mocks.fetchBacklinkSummary.mockRejectedValue(new Error("upstream exploded"));
    const ctx = makeCtx(new QuestionBudget(3));
    expect(await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "example.com" })).toEqual({ error: "failed" });
    expect(ctx.budget.spent).toBe(0);
    expect(ctx.notices).toEqual([]);
  });

  it("uses the same gate on the keyword tools and normalises keywords", async () => {
    const ctx = makeCtx(new QuestionBudget(0));
    const tools = toolsFor("keywords", ctx);
    await run(tools, "keyword_ideas", { keywords: ["  seo tool ", "", "crm"] });
    expect(ctx.budget.planned).toEqual([{ tool: "keyword_ideas", input: { keywords: ["seo tool", "crm"] }, credits: 1 }]);
    expect(await run(tools, "keyword_ideas", { keywords: ["   ", ""] })).toEqual({ error: "invalid_keywords" });
  });

  it("fetches keyword ideas with the trimmed keywords", async () => {
    const ctx = makeCtx(new QuestionBudget(3));
    await run(toolsFor("keywords", ctx), "keyword_ideas", { keywords: ["  seo tool ", "crm"] });
    expect(mocks.fetchKeywordIdeas.mock.calls[0]?.[1]).toEqual(["seo tool", "crm"]);
    expect(ctx.budget.spent).toBe(1);
  });

  it("shows the model the first 25 rows of a 1000-row result and the full total", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ domain: `site${i}.com`, rank: i, backlinks: 1, spamScore: 0, firstSeen: null }));
    mocks.fetchReferringDomains.mockResolvedValue({ value: rows, cached: false });
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("backlinks", ctx), "referring_domains", { domain: "example.com" }) as { source: string; data: { rows: unknown[]; total: number } };
    expect(result.source).toBe("live");
    expect(result.data.rows).toHaveLength(25);
    expect(result.data.rows[0]).toEqual(rows[0]);
    expect(result.data.total).toBe(1000);
    expect(ctx.cards[0]?.data).toHaveLength(100);
  });

  it("applies the same model cap to a cache hit", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ domain: `site${i}.com`, rank: i, backlinks: 1, spamScore: 0, firstSeen: null }));
    mocks.peekDataForSeo.mockImplementation(async (endpoint: string) => (endpoint === "/v3/backlinks/referring_domains/live" ? rows : null));
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("backlinks", ctx), "referring_domains", { domain: "example.com" });
    expect(result).toEqual({ source: "cached", data: { rows: rows.slice(0, 25), total: 1000 } });
    expect(ctx.cards[0]?.data).toHaveLength(100);
    expect(ctx.budget.spent).toBe(0);
  });

  it("passes a non-array result through unchanged, labelled with its source", async () => {
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("backlinks", ctx), "backlink_summary", { domain: "example.com" });
    expect(result).toEqual({ source: "live", data: summary });
    expect(ctx.cards[0]?.data).toEqual(summary);
  });

  it("requires engines on llm_response", () => {
    const schema = toolsFor("geo_visibility", makeCtx()).llm_response!.inputSchema as z.ZodType;
    expect(schema.safeParse({ prompt: "best crm" }).success).toBe(false);
    expect(schema.safeParse({ prompt: "best crm", engines: [] }).success).toBe(false);
    expect(schema.safeParse({ prompt: "best crm", engines: ["claude"] }).success).toBe(true);
  });

  it("gives Google SERP a trimmed keyword and a card", async () => {
    mocks.fetchGoogleSerp.mockResolvedValue({ value: { organic: [], hasAiOverview: false, peopleAlsoAsk: [] }, cached: false });
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("serp", ctx), "google_serp", { keyword: "  crm software " });
    expect(result).toEqual({ source: "live", data: { organic: [], hasAiOverview: false, peopleAlsoAsk: [] } });
    expect(mocks.fetchGoogleSerp).toHaveBeenCalledWith(WORKSPACE, "crm software", expect.anything());
    expect(ctx.cards[0]).toMatchObject({ tool: "google_serp", cached: false });
  });

  it("charges backlink_gap one credit per uncached side and computes the gap", async () => {
    mocks.fetchReferringDomains.mockImplementation(async (_ws: string, target: string) => ({
      value: target === "example.com" ? ownDomains : rivalDomains,
      cached: false,
    }));
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("backlinks", ctx), "backlink_gap", { domain: "example.com", competitor: "rival.io" });
    expect(result).toEqual({
      source: "live",
      data: {
        rows: [
          { domain: "b.com", rank: 50, backlinks: 3, spamScore: 0, firstSeen: null },
          { domain: "c.com", rank: 20, backlinks: 1, spamScore: 0, firstSeen: null },
        ],
        total: 2,
      },
    });
    expect(ctx.budget.spent).toBe(2);
    expect(ctx.cards[0]).toMatchObject({ tool: "backlink_gap", cached: false });
  });

  it("labels a backlink_gap built only from cache as cached data, with no reservation", async () => {
    mocks.peekDataForSeo.mockImplementation(async (_endpoint: string, task: Record<string, unknown>) => (task.target === "example.com" ? ownDomains : rivalDomains));
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("backlinks", ctx), "backlink_gap", { domain: "example.com", competitor: "rival.io" }) as { source: string };
    expect(result.source).toBe("cached");
    expect(ctx.budget.spent).toBe(0);
    expect(mocks.fetchReferringDomains).not.toHaveBeenCalled();
  });

  it("labels a backlink_gap with one fetched side as live data", async () => {
    mocks.peekDataForSeo.mockImplementation(async (_endpoint: string, task: Record<string, unknown>) => (task.target === "example.com" ? ownDomains : null));
    mocks.fetchReferringDomains.mockImplementation(async () => ({ value: rivalDomains, cached: false }));
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("backlinks", ctx), "backlink_gap", { domain: "example.com", competitor: "rival.io" }) as { source: string };
    expect(result.source).toBe("live");
  });

  it("charges backlink_gap only for the uncached side", async () => {
    mocks.peekDataForSeo.mockImplementation(async (_endpoint: string, task: Record<string, unknown>) => (task.target === "example.com" ? ownDomains : null));
    mocks.fetchReferringDomains.mockImplementation(async (_ws: string, target: string) => ({
      value: target === "example.com" ? ownDomains : rivalDomains,
      cached: target === "example.com",
    }));
    const ctx = makeCtx(new QuestionBudget(3));
    await run(toolsFor("backlinks", ctx), "backlink_gap", { domain: "example.com", competitor: "rival.io" });
    expect(ctx.budget.spent).toBe(1);
  });

  it("asks for approval on backlink_gap with the uncached credit total", async () => {
    const ctx = makeCtx(new QuestionBudget(1));
    const result = await run(toolsFor("backlinks", ctx), "backlink_gap", { domain: "example.com", competitor: "rival.io" });
    expect(result).toEqual({ status: "needs_approval", credits: 2 });
    expect(mocks.fetchReferringDomains).not.toHaveBeenCalled();
    expect(ctx.budget.planned[0]).toEqual({ tool: "backlink_gap", input: { domain: "example.com", competitor: "rival.io" }, credits: 2 });
  });

  it("refunds only the failed side of backlink_gap", async () => {
    mocks.fetchReferringDomains.mockImplementation(async (_ws: string, target: string) => {
      if (target === "rival.io") throw new Error("upstream exploded");
      return { value: ownDomains, cached: false };
    });
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("backlinks", ctx), "backlink_gap", { domain: "example.com", competitor: "rival.io" });
    expect(result).toEqual({ error: "failed" });
    expect(ctx.budget.spent).toBe(1);
    expect(ctx.cards).toEqual([]);
  });

  it("serves an all-cached llm_response with no reservation even when GEO always asks", async () => {
    mocks.peekLlmResponse.mockImplementation(async (engine: string) => ({ ...answer, engine }));
    const ctx = makeCtx(new QuestionBudget(3));
    const result = await run(toolsFor("geo_visibility", ctx), "llm_response", { prompt: "best crm", engines: ALL_ENGINES });
    expect(result).toEqual({ answers: ALL_ENGINES.map((engine) => ({ ...answer, engine, source: "cached" })) });
    expect(ctx.cards).toHaveLength(4);
    expect(ctx.cards.every((card) => card.cached)).toBe(true);
    expect(ctx.budget.spent).toBe(0);
    expect(mocks.fetchLlmResponse).not.toHaveBeenCalled();
  });

  it("asks for approval on llm_response at two credits per engine when GEO always asks", async () => {
    const ctx = makeCtx(new QuestionBudget(20));
    const result = await run(toolsFor("geo_visibility", ctx), "llm_response", { prompt: "best seo tools", engines: ALL_ENGINES });
    expect(result).toEqual({ status: "needs_approval", credits: 8 });
    expect(mocks.fetchLlmResponse).not.toHaveBeenCalled();
    expect(ctx.budget.planned).toEqual([
      { tool: "llm_response", input: { prompt: "best seo tools", engines: ALL_ENGINES }, credits: 8 },
    ]);
  });

  it("asks when the llm_response cost is over budget even if GEO no longer always asks", async () => {
    process.env.SEO_AGENT_GEO_ALWAYS_ASK = "false";
    const ctx = makeCtx(new QuestionBudget(3));
    expect(await run(toolsFor("geo_visibility", ctx), "llm_response", { prompt: "best seo tools", engines: ALL_ENGINES })).toEqual({ status: "needs_approval", credits: 8 });
    expect(mocks.fetchLlmResponse).not.toHaveBeenCalled();
  });

  it("runs an approved llm_response for the planned engine and charges two credits", async () => {
    const ctx = makeCtx(new QuestionBudget(0, [{ tool: "llm_response", input: { prompt: "best seo tools", engines: ["claude"] }, credits: 2 }]));
    const result = await run(toolsFor("geo_visibility", ctx), "llm_response", { prompt: "best seo tools", engines: ["claude"] });
    expect(result).toEqual({ answers: [{ ...answer, source: "live" }] });
    expect(mocks.fetchLlmResponse.mock.calls[0]?.slice(0, 5)).toEqual([WORKSPACE, "claude", "best seo tools", "model-x", ["example.com"]]);
    expect(ctx.budget.spent).toBe(2);
  });

  it("trims the text the model and the card see to 4,000 characters, keeping the brand verdict", async () => {
    const long = { ...answer, engine: "claude", text: `${"a".repeat(6_000)} Example`, mentionsBrand: true };
    mocks.fetchLlmResponse.mockResolvedValue({ value: long, cached: false });
    const ctx = makeCtx(new QuestionBudget(0, [{ tool: "llm_response", input: { prompt: "best seo tools", engines: ["claude"] }, credits: 2 }]));
    const result = await run(toolsFor("geo_visibility", ctx), "llm_response", { prompt: "best seo tools", engines: ["claude"] }) as {
      answers: { text: string; mentionsBrand: boolean }[];
    };
    expect(result.answers[0]!.text).toHaveLength(4_000);
    expect(result.answers[0]!.mentionsBrand).toBe(true);
    expect((ctx.cards[0]!.data as { text: string }).text).toHaveLength(4_000);
  });

  it("trims a cached answer the same way before the model and the card see it", async () => {
    mocks.peekLlmResponse.mockImplementation(async (engine: string) => ({ ...answer, engine, text: "b".repeat(9_000) }));
    const ctx = makeCtx();
    const result = await run(toolsFor("geo_visibility", ctx), "llm_response", { prompt: "best crm", engines: ["claude"] }) as {
      answers: { text: string }[];
    };
    expect(result.answers[0]!.text).toHaveLength(4_000);
    expect((ctx.cards[0]!.data as { text: string }).text).toHaveLength(4_000);
  });

  it("gives each engine answer its own source: cached when peeked, live when fetched", async () => {
    process.env.SEO_AGENT_GEO_ALWAYS_ASK = "false";
    mocks.peekLlmResponse.mockImplementation(async (engine: string) => (engine === "claude" ? { ...answer, engine } : null));
    mocks.fetchLlmResponse.mockImplementation(async (_ws: string, engine: string) => ({ value: { ...answer, engine }, cached: false }));
    const ctx = makeCtx(new QuestionBudget(10));
    const result = await run(toolsFor("geo_visibility", ctx), "llm_response", { prompt: "best seo tools", engines: ["claude", "chat_gpt"] }) as { answers: { engine: string; source: string }[] };
    // Answers follow the canonical engine order, not the request order.
    expect(result.answers.map(({ engine, source }) => ({ engine, source }))).toEqual([
      { engine: "chat_gpt", source: "live" },
      { engine: "claude", source: "cached" },
    ]);
  });

  it("skips an engine with no model and says so", async () => {
    mocks.resolveLlmModel.mockImplementation(async (engine: string) => (engine === "gemini" ? null : "model-x"));
    process.env.SEO_AGENT_GEO_ALWAYS_ASK = "false";
    const ctx = makeCtx(new QuestionBudget(10));
    const result = await run(toolsFor("geo_visibility", ctx), "llm_response", { prompt: "best seo tools", engines: ALL_ENGINES }) as { answers: unknown[] };
    expect(result.answers).toHaveLength(3);
    expect(mocks.fetchLlmResponse).toHaveBeenCalledTimes(3);
    expect(ctx.budget.spent).toBe(6);
    expect(ctx.notices).toEqual(["Gemini is not available right now, so it was skipped."]);
  });

  it("refunds a failed llm_response engine and reports the error", async () => {
    process.env.SEO_AGENT_GEO_ALWAYS_ASK = "false";
    mocks.fetchLlmResponse.mockImplementation(async (_ws: string, engine: string) => {
      if (engine === "claude") throw new DataForSeoDeniedError("reserve_floor", "The DataForSEO balance is below the reserve floor.");
      return { value: { ...answer, engine }, cached: false };
    });
    const ctx = makeCtx(new QuestionBudget(10));
    const result = await run(toolsFor("geo_visibility", ctx), "llm_response", { prompt: "best seo tools", engines: ["claude", "chat_gpt"] });
    expect(result).toEqual({ answers: [{ ...answer, engine: "chat_gpt", source: "live" }], error: "reserve_floor" });
    expect(ctx.budget.spent).toBe(2);
    expect(ctx.notices).toEqual([DATAFORSEO_PAUSED]);
  });

  it("gives the GEO intent its data tools, research tools and follow-ups", () => {
    const names = Object.keys(toolsFor("geo_visibility", makeCtx()));
    expect(names).toEqual(["llm_response", "ai_keyword_volume", "google_serp", "tako_search", "web_research", "linkup_fetch", "suggest_follow_ups"]);
  });
});

describe("suggest_follow_ups", () => {
  it("stores trimmed follow-ups on the context and returns ok", async () => {
    const ctx = makeCtx();
    const result = await run(toolsFor("backlinks", ctx), "suggest_follow_ups", {
      seo: "  Check titles ",
      geo: "Ask ChatGPT about it",
      content: "Outline a guide",
    });
    expect(result).toEqual({ ok: true });
    expect(ctx.followUps).toEqual({ seo: "Check titles", geo: "Ask ChatGPT about it", content: "Outline a guide" });
  });

  it("limits each follow-up to 140 characters and rejects extra keys", () => {
    const schema = toolsFor("backlinks", makeCtx()).suggest_follow_ups!.inputSchema as z.ZodType;
    expect(schema.safeParse({ seo: "x".repeat(141), geo: "a", content: "b" }).success).toBe(false);
    expect(schema.safeParse({ seo: "x".repeat(140), geo: "a", content: "b" }).success).toBe(true);
    expect(schema.safeParse({ seo: "a", geo: "a", content: "b", extra: 1 }).success).toBe(false);
  });
});

describe("tool definitions", () => {
  it("rejects unknown input keys on a data tool", () => {
    const schema = toolsFor("backlinks", makeCtx()).backlink_summary!.inputSchema as z.ZodType;
    expect(schema.safeParse({ domain: "example.com", extra: 1 }).success).toBe(false);
  });

  it("marks host-executed tools strict while leaving provider tools in their native form", () => {
    for (const [name, definition] of Object.entries(toolsFor("all", makeCtx()))) {
      if (name === "tako_search") continue;
      expect(definition.strict, name).toBe(true);
    }
  });

  it("gives keywords intent its data tools, research tools and follow-ups", () => {
    expect(Object.keys(toolsFor("keywords", makeCtx()))).toEqual([
      "keyword_ideas",
      "keyword_overview",
      "ranked_keywords",
      "competitor_domains",
      "keyword_gap",
      "tako_search",
      "web_research",
      "linkup_fetch",
      "suggest_follow_ups",
    ]);
  });

  it("gives backlinks intent its data tools, research tools and follow-ups", () => {
    expect(Object.keys(toolsFor("backlinks", makeCtx()))).toEqual([
      "backlink_summary",
      "referring_domains",
      "backlink_gap",
      "anchors",
      "tako_search",
      "web_research",
      "linkup_fetch",
      "suggest_follow_ups",
    ]);
  });

  it("gives content intent its data tools, research tools and follow-ups", () => {
    expect(Object.keys(toolsFor("content", makeCtx()))).toEqual([
      "keyword_ideas",
      "keyword_overview",
      "google_serp",
      "ranked_keywords",
      "tako_search",
      "web_research",
      "linkup_fetch",
      "suggest_follow_ups",
    ]);
  });

  it("gives the classifier-failed intent every data tool once, plus follow-ups", () => {
    const names = Object.keys(toolsFor("all", makeCtx()));
    expect(names.sort()).toEqual([
      "ai_keyword_volume",
      "anchors",
      "backlink_gap",
      "backlink_summary",
      "competitor_domains",
      "google_serp",
      "keyword_gap",
      "keyword_ideas",
      "keyword_overview",
      "linkup_fetch",
      "llm_response",
      "ranked_keywords",
      "referring_domains",
      "suggest_follow_ups",
      "tako_search",
      "web_research",
    ]);
  });

  it("gives concept and out-of-scope answers no tools", () => {
    expect(toolsFor("concept", makeCtx())).toEqual({});
    expect(toolsFor("out_of_scope", makeCtx())).toEqual({});
  });
});
