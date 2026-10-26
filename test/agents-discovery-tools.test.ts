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
