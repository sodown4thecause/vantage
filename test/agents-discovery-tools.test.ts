import { describe, expect, it, vi } from "vitest";

import { createDiscoveryContext, discoveryTools } from "@/lib/agents/discovery";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

const profile = {
  productName: "Vantage",
  description: "Finds the conversations where developers ask for tools like yours.",
  category: "Go-to-market tooling for AI developer products",
  audience: "Founders of AI developer tools",
  pricingTier: "paid" as const,
  differentiators: ["Owner writes every reply", "Scores buying intent"],
  evidenceUrl: "https://contextfor.dev/",
};

function setup(over: Partial<Parameters<typeof createDiscoveryContext>[0]> = {}) {
  const fetchPage = vi.fn(async (url: string) => ({ value: { url, markdown: "# Vantage\nFinds buying-intent threads." }, cached: false }));
  const search = vi.fn(async () => ({ value: { results: [{ title: "T", url: "https://example.com/a", snippet: "s" }] }, cached: false }));
  const ctx = createDiscoveryContext({
    workspaceId: "ws", productUrl: "https://contextfor.dev/", kind: "initial", remainingUsd: 0.5,
    deps: { fetchPage, search }, ...over,
  });
  const tools = discoveryTools(ctx);
  // Tool objects are plain; calling execute directly keeps a model out of these tests.
  const run = (name: keyof typeof tools, input: unknown) =>
    (tools[name] as unknown as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, { toolCallId: "t", messages: [] });
  return { ctx, run, fetchPage, search };
}

describe("discovery tools", () => {
  it("reads pages and searches only through the Linkup client, attributing spend to discovery", async () => {
    const { run, fetchPage, search, ctx } = setup();
    await run("read_page", { url: "https://contextfor.dev/" });
    await run("search_web", { query: "syften alternative" });
    expect(fetchPage).toHaveBeenCalledWith("https://contextfor.dev/", expect.objectContaining({ workspaceId: "ws", sourceKey: "discovery" }));
    expect(search).toHaveBeenCalledWith({ query: "syften alternative" }, expect.objectContaining({ workspaceId: "ws", sourceKey: "discovery" }));
    expect(ctx.spentUsd).toBeCloseTo(0.006, 6);
  });

  it("marks fetched page text as untrusted data", async () => {
    const { run } = setup();
    const out = await run("read_page", { url: "https://contextfor.dev/" }) as { untrusted: boolean };
    expect(out.untrusted).toBe(true);
  });

  it("does not charge the run for a cached result", async () => {
    const { run, ctx } = setup({ deps: { fetchPage: async (url: string) => ({ value: { url, markdown: "x" }, cached: true }), search: vi.fn() } });
    await run("read_page", { url: "https://contextfor.dev/" });
    expect(ctx.spentUsd).toBe(0);
  });

  it("stops the run and makes no call when the remaining budget cannot cover the next one", async () => {
    const { run, fetchPage, ctx } = setup({ remainingUsd: 0.0005 });
    expect(await run("read_page", { url: "https://contextfor.dev/" })).toEqual({ error: "budget_exhausted" });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(ctx.stopped).toBe(true);
  });

  it("treats a provider denial as the end of the run, not a crash", async () => {
    const { run, ctx } = setup({ deps: { fetchPage: async () => { throw new PaidCallDeniedError("budget_exhausted", "cap"); }, search: vi.fn() } });
    expect(await run("read_page", { url: "https://contextfor.dev/" })).toEqual({ error: "budget_exhausted" });
    expect(ctx.stopped).toBe(true);
  });

  it("returns typed results for each proposal kind and keeps them on the context", async () => {
    const { run, ctx } = setup();
    expect(await run("propose_profile", profile)).toMatchObject({ kind: "profile", status: "proposed" });
    expect(await run("propose_competitor", { domain: "syften.com", positioning: "Reddit alerts.", evidenceUrl: "https://syften.com/" }))
      .toMatchObject({ kind: "competitor", status: "proposed", proposal: { domain: "syften.com" } });
    expect(await run("propose_keyword", { keyword: "syften alternative", kind: "competitor", rationale: "Buyers compare.", evidenceUrl: "https://syften.com/" }))
      .toMatchObject({ kind: "keyword", status: "proposed" });
    expect(ctx.results.map((r) => r.kind)).toEqual(["profile", "competitor", "keyword"]);
  });

  it("skips duplicates and the owner's own domain", async () => {
    const { run } = setup();
    await run("propose_profile", profile);
    expect(await run("propose_profile", profile)).toMatchObject({ kind: "profile", status: "duplicate" });
    const comp = { domain: "syften.com", positioning: "Reddit alerts.", evidenceUrl: "https://syften.com/" };
    await run("propose_competitor", comp);
    expect(await run("propose_competitor", { ...comp, domain: "syften.com" })).toMatchObject({ status: "duplicate" });
    expect(await run("propose_competitor", { ...comp, domain: "contextfor.dev" })).toMatchObject({ status: "duplicate" });
  });

  it("caps keywords at 20 and competitors at 8", async () => {
    const { run } = setup();
    const ev = "https://example.com/";
    for (let i = 0; i < 20; i++) await run("propose_keyword", { keyword: `keyword number ${i}`, kind: "category", rationale: "r", evidenceUrl: ev });
    expect(await run("propose_keyword", { keyword: "one too many", kind: "category", rationale: "r", evidenceUrl: ev })).toMatchObject({ status: "limit_reached" });
    for (let i = 0; i < 8; i++) await run("propose_competitor", { domain: `rival${i}.com`, positioning: "p", evidenceUrl: ev });
    expect(await run("propose_competitor", { domain: "rival9.com", positioning: "p", evidenceUrl: ev })).toMatchObject({ status: "limit_reached" });
  });

  it("asks for the profile before judging a source, because the gate needs it", async () => {
    const { run } = setup();
    expect(await run("propose_source", { sourceType: "hn", name: "HN", queries: ["developer tool marketing"], rationale: "r", relevanceScore: 0.9 }))
      .toMatchObject({ kind: "source", status: "not_ready" });
  });

  it("REGRESSION 25 Oct: the broad HN profile source is rejected at proposal time with reasons", async () => {
    const { run, ctx } = setup();
    await run("propose_profile", profile);
    const out = await run("propose_source", {
      sourceType: "hn", name: "Profile: Hacker News", queries: ["ai", "startup", "automation", "tools", "show hn"], rationale: "Popular with founders.", relevanceScore: 0.9,
    }) as { status: string; review: { accepted: boolean; reasons: string[] } };
    expect(out.status).toBe("rejected");
    expect(out.review.accepted).toBe(false);
    expect(out.review.reasons.length).toBeGreaterThan(0);
    expect(ctx.sources.filter((s) => s.review.accepted)).toHaveLength(0);
    expect(ctx.sources).toHaveLength(1); // kept so the owner can see why it was rejected
  });

  it("proposes a specific source, using proposed competitors and keywords as vocabulary", async () => {
    const { run, ctx } = setup();
    await run("propose_profile", profile);
    await run("propose_competitor", { domain: "syften.com", positioning: "Reddit alerts.", evidenceUrl: "https://syften.com/" });
    const out = await run("propose_source", { sourceType: "hn", name: "HN: syften alternative", queries: ["syften alternative", "developer tool marketing"], rationale: "Comparison threads.", relevanceScore: 0.8 });
    expect(out).toMatchObject({ kind: "source", status: "proposed" });
    expect(ctx.sources.filter((s) => s.review.accepted)).toHaveLength(1);
  });

  it("does not let an unrelated proposed keyword vouch for a source that queries it", async () => {
    const { run, ctx } = setup();
    await run("propose_profile", profile);
    await run("propose_keyword", { keyword: "kubernetes", kind: "category", rationale: "r", evidenceUrl: "https://example.com/" });
    const out = await run("propose_source", { sourceType: "hn", name: "HN: kubernetes", queries: ["kubernetes"], rationale: "r", relevanceScore: 0.9 });
    expect(out).toMatchObject({ kind: "source", status: "rejected" });
    expect(ctx.sources[0]!.review.accepted).toBe(false);
  });

  it("still counts a proposed keyword that names something from the product profile", async () => {
    const { run } = setup();
    await run("propose_profile", profile);
    await run("propose_keyword", { keyword: "developer outreach", kind: "category", rationale: "r", evidenceUrl: "https://example.com/" });
    expect(await run("propose_source", { sourceType: "hn", name: "HN: developer outreach", queries: ["developer outreach"], rationale: "r", relevanceScore: 0.9 }))
      .toMatchObject({ status: "proposed" });
  });

  describe("the six-source limit", () => {
    const good = (n: number) => ({ sourceType: "hn", name: `HN: vantage ${n}`, queries: [`vantage tours ${n}`], rationale: "r", relevanceScore: 0.9 });
    const weak = (n: number) => ({ sourceType: "hn", name: `HN: weak ${n}`, queries: ["ai", "startup"], rationale: "r", relevanceScore: 0.9 });

    it("counts only accepted sources, so rejected proposals leave room for a good one", async () => {
      const { run } = setup();
      await run("propose_profile", profile);
      for (let n = 1; n <= 7; n++) expect(await run("propose_source", weak(n))).toMatchObject({ status: "rejected" });
      expect(await run("propose_source", good(1))).toMatchObject({ status: "proposed" });
    });

    it("stops at six accepted sources", async () => {
      const { run, ctx } = setup();
      await run("propose_profile", profile);
      for (let n = 1; n <= 6; n++) await run("propose_source", good(n));
      expect(await run("propose_source", good(7))).toMatchObject({ status: "limit_reached" });
      expect(ctx.sources.filter((s) => s.review.accepted)).toHaveLength(6);
    });

    it("reserves a slot before awaiting the review, so parallel proposals neither exceed six nor pay for extra reviews", async () => {
      const judge = vi.fn(async (_p: unknown, source: { queries: string[] }) =>
        ({ judgements: source.queries.map((query) => ({ query, fit: 0.9, rung: 3, situation: "other", why: "mock" })), costUsd: 0.001 }));
      const { run, ctx } = setup({ judge });
      await run("propose_profile", profile);
      const outs = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => run("propose_source", good(n)))) as Array<{ status: string }>;
      expect(outs.filter((o) => o.status === "proposed")).toHaveLength(6);
      expect(outs.filter((o) => o.status === "limit_reached")).toHaveLength(2);
      expect(judge).toHaveBeenCalledTimes(6);
      expect(ctx.sources.filter((s) => s.review.accepted)).toHaveLength(6);
    });
  });

  describe("AI relevance review", () => {
    const judgeResult = (fit: number, costUsd = 0.004) => vi.fn(async (_p: unknown, source: { queries: string[] }) =>
      ({ judgements: source.queries.map((query) => ({ query, fit, rung: 3, situation: "other", why: "mock verdict" })), costUsd }));
    const specific = { sourceType: "hn", name: "HN: vantage", queries: ["vantage tours"], rationale: "r", relevanceScore: 0.9 };

    it("rejects a source that passes the term pre-filter when the review says it does not fit", async () => {
      const judge = judgeResult(0.05);
      const { run, ctx } = setup({ judge });
      await run("propose_profile", profile);
      const out = await run("propose_source", specific) as { status: string; review: { method: string } };
      expect(out.status).toBe("rejected");
      expect(out.review.method).toBe("ai");
      expect(judge).toHaveBeenCalledTimes(1);
      expect(ctx.sources[0]!.review.accepted).toBe(false);
    });

    it("never spends on the review for the broad HN profile source, even when the reviewer would approve it", async () => {
      const judge = judgeResult(0.99);
      const { run } = setup({ judge });
      await run("propose_profile", profile);
      const out = await run("propose_source", { ...specific, name: "Profile: Hacker News", queries: ["ai", "startup", "tools"] }) as { status: string };
      expect(out.status).toBe("rejected");
      expect(judge).not.toHaveBeenCalled();
    });

    it("counts the review's real cost against the run", async () => {
      const { run, ctx } = setup({ judge: judgeResult(0.9, 0.004) });
      await run("propose_profile", profile);
      await run("propose_source", specific);
      expect(ctx.spentUsd).toBeCloseTo(0.004, 6);
    });

    it("reserves the estimate up front, so parallel proposals cannot together overspend the run", async () => {
      const judge = judgeResult(0.9);
      const { run, ctx } = setup({ judge, remainingUsd: 0.015 });
      await run("propose_profile", profile);
      const outs = await Promise.all([1, 2, 3].map((n) => run("propose_source", { ...specific, name: `HN: vantage ${n}`, queries: [`vantage tours ${n}`] }))) as Array<{ review: { method: string } }>;
      expect(judge).toHaveBeenCalledTimes(1);
      expect(outs.map((o) => o.review.method)).toEqual(["ai", "terms", "terms"]);
      expect(ctx.spentUsd).toBeLessThanOrEqual(0.015);
    });

    it("falls back to the term match, and says so, once the run's budget is spent", async () => {
      const judge = judgeResult(0.9);
      const { run } = setup({ judge, remainingUsd: 0.001 });
      await run("propose_profile", profile);
      const out = await run("propose_source", specific) as { status: string; review: { method: string; reasons: string[] } };
      expect(judge).not.toHaveBeenCalled();
      expect(out.review.method).toBe("terms");
      expect(out.review.reasons.join(" ")).toMatch(/budget/i);
    });
  });

  it("exposes no tool that posts, comments, votes, submits or emails", () => {
    const { ctx } = setup();
    expect(Object.keys(discoveryTools(ctx)).sort()).toEqual(
      ["propose_competitor", "propose_keyword", "propose_profile", "propose_source", "read_page", "search_web"],
    );
  });

  it("never touches the database", async () => {
    const { run } = setup();
    await run("propose_profile", profile); // would throw if a tool reached getDb with no DATABASE_URL
  });
});
