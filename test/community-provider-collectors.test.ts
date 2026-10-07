import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ paid: vi.fn() }));
vi.mock("@/lib/providers/paid-call", () => ({ runPaidCall: mocks.paid }));

import { alexandriaCollector } from "@/lib/collectors/alexandria";
import { linkedinCollector } from "@/lib/collectors/linkedin";
import { COMMUNITY_SOURCE_CATALOG } from "@/lib/communities/catalog";

const ctx = { workspaceId: "workspace", sourceId: "source", config: { query: "agent evaluation" } };
beforeEach(() => {
  mocks.paid.mockReset();
  mocks.paid.mockImplementation(async (_options, work) => (await work()).value);
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
    vi.stubGlobal("fetch", async () => Response.json({ success: true, data: { alexandria: [{ provider: "firecrawl-developer-index", capability: "search", data: { success: true, results: [] } }] } }));
    expect((await alexandriaCollector.run(ctx)).documents).toEqual([]);
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
    expect((await linkedinCollector.run(ctx)).documents).toEqual([]);
    mocks.paid.mockRejectedValue(new Error("Budget denied"));
    await expect(linkedinCollector.run(ctx)).rejects.toThrow("Budget denied");
    expect(request).toHaveBeenCalledTimes(1);
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
