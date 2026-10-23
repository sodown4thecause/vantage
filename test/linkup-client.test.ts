import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runPaidCall: vi.fn(),
  readCache: vi.fn(),
  writeCache: vi.fn(),
}));

vi.mock("@/lib/providers/paid-call", () => ({ runPaidCall: mocks.runPaidCall }));
vi.mock("@/lib/dataforseo/cache", () => ({
  dataForSeoCacheKey: (_env: string, endpoint: string, params: unknown) => `${endpoint}:${JSON.stringify(params)}`,
  readDataForSeoCache: mocks.readCache,
  writeDataForSeoCache: mocks.writeCache,
}));

import { fetchLinkupPage, LinkupNotConfiguredError, searchLinkup } from "@/lib/linkup/client";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const result = { name: "AI Gateway docs", url: "https://vercel.com/docs/ai-gateway", content: "Provider tools and models." };

beforeEach(() => {
  vi.stubEnv("LINKUP_API_KEY", "test-linkup-key");
  mocks.runPaidCall.mockReset().mockImplementation(async (_meta: unknown, work: () => Promise<{ value?: unknown; error?: Error }>) => {
    const outcome = await work();
    if (outcome.error) throw outcome.error;
    return outcome.value;
  });
  mocks.readCache.mockReset().mockResolvedValue(null);
  mocks.writeCache.mockReset().mockResolvedValue(undefined);
});

describe("Linkup client", () => {
  it("uses standard searchResults with normalized filters, provider budgeting and a workspace-scoped 24-hour cache key", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      void url;
      void init;
      return new Response(JSON.stringify({ results: [result] }), { status: 200 });
    });
    const value = await searchLinkup({
      query: "AI gateway",
      includeDomains: ["vercel.com", "docs.linkup.so"],
      fromDate: "2026-01-01",
    }, { workspaceId: WORKSPACE, fetchImpl: fetchImpl as typeof fetch });

    expect(value).toEqual({
      value: { results: [{ title: "AI Gateway docs", url: "https://vercel.com/docs/ai-gateway", snippet: "Provider tools and models." }] },
      cached: false,
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({
      q: "AI gateway",
      depth: "standard",
      outputType: "searchResults",
      maxResults: 10,
      includeDomains: ["docs.linkup.so", "vercel.com"],
      fromDate: "2026-01-01",
    });
    expect(fetchImpl.mock.calls[0]![0]).toContain("https://api.linkup.so/v1/search");
    expect(mocks.runPaidCall).toHaveBeenCalledWith(expect.objectContaining({
      context: { workspaceId: WORKSPACE, sourceKey: "seo" },
      provider: "linkup",
      action: "web_research",
      estimateUsd: 0.005,
    }), expect.any(Function));
    expect(mocks.readCache.mock.calls[0]![1]).toBe(86_400);
    expect(mocks.readCache.mock.calls[0]![0]).toContain(WORKSPACE);
  });

  it("serves a cached search without a key, fetch, or paid reservation", async () => {
    vi.stubEnv("LINKUP_API_KEY", "");
    mocks.readCache.mockResolvedValue({ results: [{ title: "Cached", url: "https://example.com", snippet: "Cached excerpt" }] });
    await expect(searchLinkup({ query: "cached query" }, { workspaceId: WORKSPACE })).resolves.toMatchObject({ cached: true });
    expect(mocks.runPaidCall).not.toHaveBeenCalled();
  });

  it("fetches a public page in standard non-JavaScript mode and uses the fetch price", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      void url;
      void init;
      return new Response(JSON.stringify({ markdown: "Readable page text", contentType: "html" }), { status: 200 });
    });
    await expect(fetchLinkupPage("https://example.com/article", { workspaceId: WORKSPACE, fetchImpl: fetchImpl as typeof fetch }))
      .resolves.toEqual({ value: { url: "https://example.com/article", markdown: "Readable page text" }, cached: false });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toMatchObject({
      url: "https://example.com/article",
      mode: "standard",
      renderJs: false,
      includeRawContent: false,
      includeRawHtml: false,
    });
    expect(mocks.runPaidCall).toHaveBeenCalledWith(expect.objectContaining({ provider: "linkup", action: "fetch_page", estimateUsd: 0.001 }), expect.any(Function));
  });

  it("rejects non-public URLs before reserving provider budget", async () => {
    await expect(fetchLinkupPage("http://127.0.0.1/private", { workspaceId: WORKSPACE })).rejects.toThrow("public HTTP(S) URL");
    expect(mocks.runPaidCall).not.toHaveBeenCalled();
  });

  it("fails as not configured without reserving a paid call", async () => {
    vi.stubEnv("LINKUP_API_KEY", "");
    await expect(searchLinkup({ query: "current facts" }, { workspaceId: WORKSPACE })).rejects.toBeInstanceOf(LinkupNotConfiguredError);
    expect(mocks.runPaidCall).not.toHaveBeenCalled();
  });
});
