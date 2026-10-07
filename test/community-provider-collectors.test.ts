import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ paid: vi.fn(), costs: [] as Array<number | undefined> }));
vi.mock("@/lib/providers/paid-call", () => ({ runPaidCall: mocks.paid }));

import { alexandriaCollector } from "@/lib/collectors/alexandria";
import { linkedinCollector } from "@/lib/collectors/linkedin";
import { COMMUNITY_SOURCE_CATALOG } from "@/lib/communities/catalog";

const ctx = { workspaceId: "workspace", sourceId: "source", config: { query: "agent evaluation" } };
beforeEach(() => {
  mocks.paid.mockReset();
  mocks.costs = [];
  mocks.paid.mockImplementation(async (_options, work) => {
    const result = await work();
    mocks.costs.push(result.costUsd);
    return result.value;
  });
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  vi.stubEnv("FIRECRAWL_CREDIT_USD", "0.001");
  vi.stubEnv("SCAVIO_API_KEY", "test-key");
  vi.stubEnv("SCAVIO_GOOGLE_COST_USD", "0.004");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("paid developer discovery", () => {
  it("uses the verified Alexandria developer contract and labels discovery evidence", async () => {
    const request = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ success: true, data: { creditsCost: 2, alexandria: [{ provider: "firecrawl-developer-index", capability: "search", creditsCost: 2, data: { success: true, partial: true, results: [{ id: "issue-7", url: "https://github.com/acme/agent/issues/7", title: "Evaluation", passages: [{ text: "Existing method is unreliable" }] }] } }] } })); vi.stubGlobal("fetch", request);
    const result = await alexandriaCollector.run(ctx);
    expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toEqual({ alexandria: [{ provider: "firecrawl-developer-index", capability: "search", options: { query: "agent evaluation", k: 10, passages: 1 } }] });
    expect(result.documents[0]).toMatchObject({ platform: "github", postedAt: null, contentMd: "Existing method is unreliable", metadata: { provider: "firecrawl", dataset: "firecrawl-developer-index/search", discoveryOnly: true, partial: true } });
    expect(mocks.paid.mock.calls[0]?.[0]).toMatchObject({ context: { workspaceId: "workspace", sourceKey: "source" }, provider: "firecrawl", estimateUsd: 0.002 });
  });

  it("requires credit conversion and denies HTTP when the paid gate rejects", async () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    vi.stubEnv("FIRECRAWL_CREDIT_USD", "");
    await expect(alexandriaCollector.run(ctx)).rejects.toThrow(/conversion|CREDIT_USD/i);
    vi.stubEnv("FIRECRAWL_CREDIT_USD", "0.001");
    mocks.paid.mockRejectedValue(new Error("Paid budget disabled"));
    await expect(alexandriaCollector.run(ctx)).rejects.toThrow("Paid budget disabled");
    expect(request).not.toHaveBeenCalled();
  });

  it("allows only the two discovered Alexandria dataset contracts", async () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    await expect(alexandriaCollector.run({ ...ctx, config: { provider: "arbitrary", capability: "private" } })).rejects.toThrow(/allowlist|supported/i);
    expect(request).not.toHaveBeenCalled();
  });

  it("returns empty Alexandria data honestly and rejects failed dataset execution", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ success: true, data: { alexandria: [{ provider: "firecrawl-developer-index", capability: "search", data: { success: true, results: [], partial: true } }] } }));
    const empty = await alexandriaCollector.run(ctx);
    expect(empty.documents).toEqual([]);
    expect(empty.partial).toBe(true);
    vi.stubGlobal("fetch", async () => Response.json({ success: true, data: { alexandria: [{ provider: "firecrawl-developer-index", capability: "search", data: { success: false, error: "provider denied" } }] } }));
    await expect(alexandriaCollector.run(ctx)).rejects.toThrow(/failed|denied/i);
  });

  it("bounds repository-issues pages and meters the verified five-credit contract", async () => {
    const request = vi.fn(async () => Response.json({ success: true, data: { creditsCost: 5, alexandria: [{ provider: "github-com", capability: "repositories/issues", data: { has_next: true, issues: [{ id: 42, number: 7, source_url: "https://github.com/acme/agent/issues/7", title: "Agent eval", body: "Compare runs", created_at: "2026-10-01T00:00:00Z" }] } }] } })); vi.stubGlobal("fetch", request);
    const result = await alexandriaCollector.run({ ...ctx, config: { provider: "github-com", capability: "repositories/issues", repo: "acme/agent", maxPages: 50 } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({ platform: "github", postedAt: new Date("2026-10-01T00:00:00Z"), metadata: { dataset: "github-com/repositories/issues", discoveryOnly: false } });
    expect(mocks.paid.mock.calls[0]?.[0]).toMatchObject({ estimateUsd: 0.005 });
  });

  it("stops Alexandria before another paid call when its first page fills the run result cap", async () => {
    const request = vi.fn(async () => Response.json({ success: true, data: { creditsCost: 5, alexandria: [{ provider: "github-com", capability: "repositories/issues", data: { has_next: true, issues: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, source_url: `https://github.com/acme/agent/issues/${i + 1}`, body: `Question ${i + 1}` })) } }] } }));
    vi.stubGlobal("fetch", request);
    const result = await alexandriaCollector.run({ ...ctx, config: { provider: "github-com", capability: "repositories/issues", repo: "acme/agent", maxResults: 10, maxPages: 2 } });
    expect(result.documents).toHaveLength(10);
    expect(request).toHaveBeenCalledTimes(1);
    expect(mocks.paid).toHaveBeenCalledTimes(1);
  });

  it("caps combined Alexandria pages without changing the pagination page size", async () => {
    const options: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_input: string, init?: RequestInit) => {
      options.push(JSON.parse(init?.body as string).alexandria[0].options);
      const ids = options.length === 1 ? [1, 2] : [3, 4, 5];
      return Response.json({ success: true, data: { creditsCost: 5, alexandria: [{ provider: "github-com", capability: "repositories/issues", data: { has_next: true, issues: ids.map(id => ({ id, source_url: `https://github.com/acme/agent/issues/${id}`, body: `Question ${id}` })) } }] } });
    });
    const result = await alexandriaCollector.run({ ...ctx, config: { provider: "github-com", capability: "repositories/issues", repo: "acme/agent", maxResults: 3, maxPages: 2 } });
    expect(options).toMatchObject([{ page: 1, per_page: 3 }, { page: 2, per_page: 3 }]);
    expect(result.documents.map(doc => doc.metadata?.externalId)).toEqual([1, 2, 3]);
    expect(mocks.paid).toHaveBeenCalledTimes(2);
  });

  it("reports partial coverage when the final dataset page exceeds the remaining raw record cap", async () => {
    const options: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_input: string, init?: RequestInit) => {
      options.push(JSON.parse(init?.body as string).alexandria[0].options);
      const firstPage = options.length === 1;
      const ids = firstPage ? [1, 2, 3] : [4, 5];
      return Response.json({ success: true, data: { creditsCost: 5, alexandria: [{ provider: "github-com", capability: "repositories/issues", data: {
        partial: false, has_next: firstPage,
        issues: ids.map(id => ({ id, source_url: `https://github.com/acme/agent/issues/${id}`, body: `Question ${id}` })),
      } }] } });
    });
    const result = await alexandriaCollector.run({ ...ctx, config: { provider: "github-com", capability: "repositories/issues", repo: "acme/agent", maxResults: 4, maxPages: 2 } });
    expect(options).toMatchObject([{ page: 1, per_page: 4 }, { page: 2, per_page: 4 }]);
    expect(result.documents.map(doc => doc.metadata?.externalId)).toEqual([1, 2, 3, 4]);
    expect(mocks.paid).toHaveBeenCalledTimes(2);
    expect(result.partial).toBe(true);
    expect(result.coverageReason).toMatch(/partial/i);
  });

  it("rejects arbitrary repository URLs before dataset execution", async () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    await expect(alexandriaCollector.run({ ...ctx, config: { provider: "github-com", capability: "repositories/issues", repo: "http://127.0.0.1/private" } })).rejects.toThrow(/repo/i);
    expect(request).not.toHaveBeenCalled();
  });

  it("treats malformed provider responses as failures rather than successful emptiness", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ success: true, data: {} }));
    await expect(alexandriaCollector.run(ctx)).rejects.toThrow(/response|dataset/i);
    vi.stubGlobal("fetch", async () => Response.json({ unexpected: [] }));
    await expect(linkedinCollector.run(ctx)).rejects.toThrow(/response|results/i);
  });

  it("labels LinkedIn coverage as partial indexed snippets with original stable post URLs", async () => {
    const request = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ organic_results: [{ title: "Agent research", link: "https://www.linkedin.com/posts/builder_agent-evaluation-activity-1234567890123456789-AbCd?utm_source=share", snippet: "Need reproducible agent evaluation" }, { title: "Login", link: "https://www.linkedin.com/login", snippet: "private" }, { link: "https://linkedin.example.com/posts/fake", snippet: "bad" }] })); vi.stubGlobal("fetch", request);
    const result = await linkedinCollector.run(ctx);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({ platform: "linkedin", postedAt: null, urlCanonical: "https://www.linkedin.com/posts/builder_agent-evaluation-activity-1234567890123456789-AbCd", contentMd: "Need reproducible agent evaluation", metadata: { provider: "scavio", coverage: "indexed_public_snippets", partial: true } });
    expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string).query).toContain("site:linkedin.com/posts/");
    expect(mocks.paid.mock.calls[0]?.[0]).toMatchObject({ provider: "scavio", action: "linkedin_indexed_search", estimateUsd: 0.004 });
  });

  it("does not invent LinkedIn posts on empty results or bypass the paid gate", async () => {
    const request = vi.fn(async () => Response.json({ organic_results: [] })); vi.stubGlobal("fetch", request);
    const empty = await linkedinCollector.run(ctx);
    expect(empty.documents).toEqual([]);
    expect(empty.partial).toBe(true);
    mocks.paid.mockRejectedValue(new Error("Budget denied"));
    await expect(linkedinCollector.run(ctx)).rejects.toThrow("Budget denied");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    [],
    "private provider body",
    { organic_results: "not an array" },
    { organic_results: [], pagination: "next" },
    { organic_results: [], pagination: { next: 2 } },
    { organic_results: [], success: "true" },
    { organic_results: [], success: false, error: "private provider token" },
  ])("rejects a malformed or unsuccessful LinkedIn search page: %j", async value => {
    vi.stubGlobal("fetch", async () => Response.json(value));
    await expect(linkedinCollector.run(ctx)).rejects.toThrow(/^Invalid Scavio indexed search response\.$/);
  });

  it.each([
    null,
    [],
    "private provider entry",
    { link: 12 },
    { link: "https://www.linkedin.com/posts/builder_agent-activity-1234567890123456789-AbCd", title: { text: "Agent" } },
    { link: "https://www.linkedin.com/posts/builder_agent-activity-1234567890123456789-AbCd", snippet: ["Agent"] },
    { link: "https://www.linkedin.com/posts/builder_agent-activity-1234567890123456789-AbCd", date: { timestamp: "2026-10-07" } },
    { link: "https://www.linkedin.com/posts/builder_agent-activity-1234567890123456789-AbCd", date: 1_791_331_200 },
  ])("rejects malformed LinkedIn result fields: %j", async item => {
    vi.stubGlobal("fetch", async () => Response.json({ organic_results: [item] }));
    await expect(linkedinCollector.run(ctx)).rejects.toThrow(/^Invalid Scavio indexed search response\.$/);
  });

  it.each([null, "3", -1, {}, true])("rejects malformed Scavio credits instead of silently estimating: %j", async credits_used => {
    vi.stubGlobal("fetch", async () => Response.json({ organic_results: [], credits_used }));
    await expect(linkedinCollector.run(ctx)).rejects.toThrow(/^Invalid Scavio indexed search response\.$/);
  });

  it("rejects non-finite returned credits", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"organic_results":[],"credits_used":1e400}'));
    await expect(linkedinCollector.run(ctx)).rejects.toThrow(/^Invalid Scavio indexed search response\.$/);
  });

  it("sanitizes malformed JSON instead of returning provider body fragments", async () => {
    vi.stubGlobal("fetch", async () => new Response("private provider token is not JSON"));
    await expect(linkedinCollector.run(ctx)).rejects.toThrow(/^Invalid Scavio indexed search response\.$/);
  });

  it.each([
    { organic_results: "not an array", credits_used: 3 },
    { organic_results: [{ link: "https://www.linkedin.com/posts/builder_agent-activity-1234567890123456789-AbCd", title: { text: "Agent" } }], credits_used: 3 },
  ])("returns real credits to the paid gate before rejecting downstream results: %j", async value => {
    vi.stubGlobal("fetch", async () => Response.json(value));
    await expect(linkedinCollector.run(ctx)).rejects.toThrow(/^Invalid Scavio indexed search response\.$/);
    expect(mocks.costs).toEqual([0.012]);
  });

  it("supports omitted optional fields and relative date text without inventing publication dates", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ success: true, credits_used: 0, organic_results: [
      { link: "https://www.linkedin.com/posts/builder_agent-activity-1234567890123456789-AbCd", snippet: "Need reproducible agent evaluation", date: "3 days ago" },
      { link: "https://www.linkedin.com/posts/builder_agent-activity-1234567890123456780-AbCd", title: "Agent evaluation question" },
    ] }));
    const result = await linkedinCollector.run(ctx);
    expect(result.documents).toHaveLength(2);
    expect(result.documents.every(doc => doc.postedAt === null)).toBe(true);
    expect(result.partial).toBe(true);
    expect(mocks.costs).toEqual([0]);
  });

  it("aborts paid collectors before provider calls", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(linkedinCollector.run({ ...ctx, signal: controller.signal })).rejects.toThrow();
    await expect(alexandriaCollector.run({ ...ctx, signal: controller.signal })).rejects.toThrow();
    expect(mocks.paid).not.toHaveBeenCalled();
  });
});

it("offers individually identifiable free feed/API sources and explicit paid discovery lanes", () => {
  expect(COMMUNITY_SOURCE_CATALOG.length).toBeGreaterThanOrEqual(25);
  expect(new Set(COMMUNITY_SOURCE_CATALOG.map(entry => entry.id)).size).toBe(COMMUNITY_SOURCE_CATALOG.length);
  expect(COMMUNITY_SOURCE_CATALOG.some(entry => entry.type === "github" && entry.lane === "free")).toBe(true);
  expect(COMMUNITY_SOURCE_CATALOG.some(entry => entry.type === "stackoverflow" && entry.lane === "free")).toBe(true);
  for (const entry of COMMUNITY_SOURCE_CATALOG) {
    expect(new URL(entry.rulesUrl).protocol).toBe("https:");
    if (["rss", "substack"].includes(entry.type)) expect(new URL(String(entry.config.feedUrl)).protocol).toBe("https:");
    if (["web_search", "linkedin"].includes(entry.type)) expect(entry.lane).toBe("paid");
  }
});
