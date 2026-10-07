import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { redditSearch, xSearch, search, fetchPages, agentRun, paidCall } = vi.hoisted(() => ({
  redditSearch: vi.fn(), xSearch: vi.fn(), search: vi.fn(), fetchPages: vi.fn(),
  agentRun: vi.fn(), paidCall: vi.fn(),
}));
vi.mock("scavio", () => ({ Scavio: class {
  reddit = { search: redditSearch }; x = { search: xSearch };
} }));
vi.mock("@/lib/tinyfish/search-fetch", () => ({ tinyFishSearch: search, tinyFishFetchMarkdown: fetchPages }));
vi.mock("@/lib/tinyfish/client", () => ({
  hasTinyFishApiKey: () => Boolean(process.env.TINYFISH_API_KEY?.trim()),
  createTinyFishClient: () => ({ agent: { run: agentRun } }),
}));
vi.mock("@/lib/providers/paid-call", () => {
  class PaidCallDeniedError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return { runPaidCall: paidCall, PaidCallDeniedError,
    isPaidCallDenied: (error: unknown) => error instanceof PaidCallDeniedError };
});

import { redditCollector } from "@/lib/collectors/reddit";
import { xCollector } from "@/lib/collectors/x";
import { fetchRedditPostsWithMeta } from "@/lib/reddit/client";
import { fetchXPostsWithMeta } from "@/lib/x/client";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

const context = { workspaceId: "ws-1", sourceKey: "reddit" };
const redditUrl = "https://www.reddit.com/r/LocalLLaMA/comments/abc/tooling/";
const xUrl = "https://x.com/builder/status/1234567890123456789";
const timestamp = "2026-10-06T12:00:00.000Z";
const redditRow = { id: "t3_abc", title: "Local model tooling", body: "Literal thread text",
  url: redditUrl, subreddit: "LocalLLaMA", author: "builder", createdAt: timestamp };
const xRow = { id: "1234567890123456789", text: "Literal retrieved post", url: xUrl,
  username: "builder", created_at: timestamp, like_count: 5 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["SCAVIO_API_KEY", "TINYFISH_API_KEY", "AI_GATEWAY_API_KEY",
    "X_GATEWAY_EXPERIMENT_ENABLED", "VANTAGE_DEMO_FIXTURES"]) vi.stubEnv(name, "");
  paidCall.mockImplementation(async (_options, work) => (await work()).value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Reddit provider routing", () => {
  it("keeps canonical search hits as previews without invented dates or billed escalation", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    search.mockResolvedValue([
      { url: "https://www.reddit.com/r/OtherForum/comments/def/tooling/", title: "Wrong community", snippet: "Unrelated", position: 1 },
      { url: redditUrl + "?utm_source=search", title: "Local model tooling", snippet: "Literal search excerpt", position: 2 },
    ]);
    fetchPages.mockResolvedValue([]);
    const result = await fetchRedditPostsWithMeta({ subreddit: "LocalLLaMA", limit: 1, ctx: context });
    expect(result).toMatchObject({ meta: { provider: "tinyfish_search_fetch" }, cursor: null,
      posts: [{ id: "abc", body: "Literal search excerpt", url: redditUrl,
        createdAt: "", contentKind: "preview", topComments: undefined }] });
    expect(search).toHaveBeenCalledWith(expect.stringContaining("site:reddit.com/r/LocalLLaMA/comments/"),
      expect.objectContaining({ includeDomains: ["reddit.com"] }));
    expect(paidCall).not.toHaveBeenCalled(); expect(redditSearch).not.toHaveBeenCalled();
  });

  it("preserves fetched public page text as a labelled page excerpt", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key");
    search.mockResolvedValue([{ url: redditUrl, title: "Local model tooling", snippet: "Excerpt", position: 1 }]);
    fetchPages.mockResolvedValue([{ url: redditUrl, text: "# Literal page\nThread and public replies", highlights: [] }]);
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts[0]).toMatchObject({
      body: "# Literal page\nThread and public replies", contentKind: "page_excerpt" });
  });

  it("marks unexpanded search previews as discovery-only collector evidence", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key");
    const fetchedUrl = "https://www.reddit.com/r/LocalLLaMA/comments/def/other_tooling/";
    search.mockResolvedValue([
      { url: redditUrl, title: "Preview only", snippet: "Indexed excerpt", position: 1 },
      { url: fetchedUrl, title: "Fetched page", snippet: "Search excerpt", position: 2 },
    ]);
    fetchPages.mockResolvedValue([{ url: fetchedUrl, text: "Literal public page text", highlights: [] }]);
    const result = await redditCollector.run({ workspaceId: "ws-1", sourceId: "src-1",
      config: { subreddit: "LocalLLaMA", limit: 2 } });
    expect(result.documents).toMatchObject([
      { urlCanonical: redditUrl, postedAt: null, metadata: { contentKind: "preview", discoveryOnly: true } },
      { urlCanonical: fetchedUrl, metadata: { contentKind: "page_excerpt", discoveryOnly: false } },
    ]);
    expect(paidCall).not.toHaveBeenCalled();
  });

  it("reports missing Reddit publication dates as partial coverage without inventing recency", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key");
    search.mockResolvedValue([{ url: redditUrl, title: "Tooling question", snippet: "Indexed excerpt", position: 1 }]);
    fetchPages.mockResolvedValue([{ url: redditUrl, text: "Literal public page text", highlights: [] }]);
    const result = await redditCollector.run({ workspaceId: "ws-1", sourceId: "src-1", config: {} });
    expect(result).toMatchObject({ partial: true, coverageReason: expect.stringMatching(/publication date.*recency/i),
      documents: [{ postedAt: null, metadata: { publicationDateMissing: true, partial: true } }] });
    expect(paidCall).not.toHaveBeenCalled();

    search.mockResolvedValue([]);
    const empty = await redditCollector.run({ workspaceId: "ws-1", sourceId: "src-1", config: {} });
    expect(empty).toMatchObject({ documents: [], partial: false });
    expect(empty.coverageReason).toBeUndefined();
  });

  it("does not escalate successful empty search", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    vi.stubEnv("VANTAGE_DEMO_FIXTURES", "true"); search.mockResolvedValue([]);
    expect(await fetchRedditPostsWithMeta({ ctx: context })).toMatchObject({ posts: [], meta: { provider: "tinyfish_search_fetch" } });
    expect(fetchPages).not.toHaveBeenCalled(); expect(paidCall).not.toHaveBeenCalled();
  });

  it("uses a bounded paid Agent after free failure and preserves five literal comments", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key"); search.mockRejectedValue(new Error("free unavailable"));
    agentRun.mockResolvedValue({ status: "COMPLETED", num_of_steps: 3, result: { posts: [{ ...redditRow,
      topComments: Array.from({ length: 8 }, (_, i) => ({ text: `Literal reply ${i}`, url: redditUrl + `reply${i}/` })) }] } });
    const result = await redditCollector.run({ workspaceId: "ws-1", sourceId: "src-1",
      config: { subreddit: "LocalLLaMA", limit: 1 } });
    expect(result.documents[0]?.metadata).toMatchObject({ provider: "tinyfish_agent", mocked: false });
    expect(result).toMatchObject({ partial: false,
      documents: [{ postedAt: new Date(timestamp), metadata: { publicationDateMissing: false, partial: false } }] });
    expect((result.documents[0]?.metadata as { topComments: unknown[] }).topComments).toHaveLength(5);
    expect(agentRun).toHaveBeenCalledWith(expect.objectContaining({ url: "https://www.reddit.com/r/LocalLLaMA/new/",
      agent_config: { mode: "strict", max_steps: 12, max_duration_seconds: 60 } }), expect.anything());
    expect(paidCall).toHaveBeenCalledWith(expect.objectContaining({ provider: "tinyfish",
      action: "agent_step", context, estimateUsd: 0.192 }), expect.any(Function));
  });

  it("keeps successful empty Agent extraction empty", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    search.mockRejectedValue(new Error("free unavailable"));
    const charges: Array<number | undefined> = [];
    paidCall.mockImplementation(async (_options, work) => {
      const result = await work(); charges.push(result.costUsd); return result.value;
    });
    agentRun.mockResolvedValue({ status: "COMPLETED", num_of_steps: 0, result: { posts: [] } });
    expect(await fetchRedditPostsWithMeta({ ctx: context })).toMatchObject({ posts: [], meta: { provider: "tinyfish_agent" } });
    expect(redditSearch).not.toHaveBeenCalled();
    expect(charges).toEqual([0.016]);
  });

  it("uses optional Scavio after Agent failure and retains its pagination cursor", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    search.mockRejectedValue(new Error("free unavailable")); agentRun.mockRejectedValue(new Error("agent unavailable"));
    redditSearch.mockResolvedValue({ data: { results: [redditRow], next_cursor: "next-page" } });
    expect(await fetchRedditPostsWithMeta({ ctx: context, query: "local models" })).toMatchObject({
      posts: [{ body: "Literal thread text" }], meta: { provider: "scavio" }, cursor: "next-page" });
    expect(paidCall).toHaveBeenCalledTimes(2);
  });

  it("does not bypass gate denial with another provider or demo fixtures", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    vi.stubEnv("VANTAGE_DEMO_FIXTURES", "true"); search.mockRejectedValue(new Error("free unavailable"));
    paidCall.mockRejectedValue(new PaidCallDeniedError("budget_exhausted", "Budget denied"));
    await expect(fetchRedditPostsWithMeta({ ctx: context })).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(agentRun).not.toHaveBeenCalled(); expect(redditSearch).not.toHaveBeenCalled();
  });

  it("drops incomplete records and external URLs instead of inventing posts", async () => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key");
    redditSearch.mockResolvedValue({ results: [{ title: "Missing identity" },
      { ...redditRow, url: "https://reddit.com.evil.test/r/a/comments/abc/" },
      { ...redditRow, url: "https://www.reddit.com/user/builder/" }] });
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts).toEqual([]);
  });

  it("normalizes supplied Reddit epoch seconds and prefers canonical permalink over outbound links", async () => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key");
    redditSearch.mockResolvedValue({ results: [{ ...redditRow, createdAt: undefined,
      created_utc: 1791288000, url: "https://example.com/article", permalink: "/r/LocalLLaMA/comments/abc/tooling/" }] });
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts[0]).toMatchObject({
      url: redditUrl, createdAt: "2026-10-06T12:00:00.000Z" });
  });

  it("passes cancellation to free provider requests and stops before paid escalation", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    const abort = new AbortController();
    search.mockImplementation(async () => { abort.abort(); throw abort.signal.reason; });
    await expect(redditCollector.run({ workspaceId: "ws-1", sourceId: "src-1",
      config: {}, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(search).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: abort.signal }));
    expect(paidCall).not.toHaveBeenCalled();
  });
});

describe("X provider routing", () => {
  it("uses Scavio's actual search contract, a canonical URL and a real timestamp", async () => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key");
    xSearch.mockResolvedValue({ data: { results: [xRow], next_cursor: "x-next" } });
    const result = await fetchXPostsWithMeta({ query: "developer tooling", searchType: "Latest", ctx: { ...context, sourceKey: "x" } });
    expect(result).toMatchObject({ posts: [{ id: "1234567890123456789", text: "Literal retrieved post",
      url: xUrl, createdAt: timestamp }], meta: { provider: "scavio" }, cursor: "x-next" });
    expect(xSearch).toHaveBeenCalledWith({ search: "developer tooling", search_type: "Latest", cursor: undefined });
    expect(paidCall).toHaveBeenCalledWith(expect.objectContaining({ provider: "scavio", action: "x_search" }), expect.any(Function));
  });

  it.each([
    { data: { results: [xRow] }, next_cursor: "top-next", expected: "top-next", count: 1 },
    { data: { results: [xRow], cursor: "nested-next" }, next_cursor: "top-next", expected: "nested-next", count: 1 },
    { data: { results: [] }, cursor: "top-empty-next", expected: "top-empty-next", count: 0 },
  ])("preserves top-level X pagination when nested data has no cursor", async ({ data, expected, count, ...top }) => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key");
    xSearch.mockResolvedValue({ data, ...top });
    const result = await fetchXPostsWithMeta({ ctx: context });
    expect(result.cursor).toBe(expected);
    expect(result.posts).toHaveLength(count);
  });

  it("reports nonempty all-filtered X results as provider-shape failure", async () => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key");
    xSearch.mockResolvedValue({ results: [{ ...xRow, created_at: undefined }, { ...xRow, created_at: "yesterday" },
      { ...xRow, url: "https://x.com/builder", id: "made-up" },
      { ...xRow, url: "https://x.com.evil.test/builder/status/1234567890123456789" }, { ...xRow, id: "777" }] });
    await expect(fetchXPostsWithMeta({ ctx: context })).rejects.toThrow(/response shape invalid/i);
  });

  it.each([{ data: { timeline: ["not a post"] } }, { results: [null] }, { results: [[]] }])(
    "reports malformed nonempty X arrays instead of successful empty results", async payload => {
      vi.stubEnv("SCAVIO_API_KEY", "test-key");
      xSearch.mockResolvedValue(payload);
      await expect(fetchXPostsWithMeta({ ctx: context })).rejects.toThrow(/response shape invalid/i);
    });

  it("reads the documented data.timeline lane with canonical URLs derived only from supplied IDs and handles", async () => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key");
    xSearch.mockResolvedValue({ data: { timeline: [{ tweet_id: "1234567890123456789",
      screen_name: "builder", text: "Literal timeline post", created_at: timestamp }] } });
    expect((await fetchXPostsWithMeta({ ctx: context })).posts[0]).toMatchObject({
      id: "1234567890123456789", url: xUrl, text: "Literal timeline post" });
  });

  it("does not request significance for genuine empty Scavio results", async () => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key"); vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("X_GATEWAY_EXPERIMENT_ENABLED", "true"); xSearch.mockResolvedValue({ results: [] });
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    expect(await fetchXPostsWithMeta({ ctx: context })).toMatchObject({ posts: [], meta: { provider: "scavio" } });
    expect(network).not.toHaveBeenCalled(); expect(paidCall).toHaveBeenCalledTimes(1);
  });

  it("does not claim a Gateway key can retrieve fresh X posts by itself", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key"); vi.stubEnv("X_GATEWAY_EXPERIMENT_ENABLED", "true");
    await expect(fetchXPostsWithMeta({ ctx: context })).rejects.toThrow(/access pending/i);
    expect(paidCall).not.toHaveBeenCalled();
  });

  it("preserves acquisition provenance and literal text in collector documents", async () => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key"); xSearch.mockResolvedValue({ results: [xRow] });
    const result = await xCollector.run({ workspaceId: "ws-1", sourceId: "src-1", config: { limit: 1 } });
    expect(result.documents[0]).toMatchObject({ urlCanonical: xUrl, postedAt: new Date(timestamp),
      metadata: { provider: "scavio", mocked: false } });
    expect(result.documents[0]?.contentMd).toContain("Literal retrieved post");
  });
});

describe.each([["Reddit", fetchRedditPostsWithMeta], ["X", fetchXPostsWithMeta]] as const)("%s access and bounds", (_name, fetchPosts) => {
  it("allows fixtures only with explicit demo opt-in outside production", async () => {
    await expect(fetchPosts({ limit: 1 })).rejects.toThrow(/access pending/i);
    vi.stubEnv("VANTAGE_DEMO_FIXTURES", "true");
    expect(await fetchPosts({ limit: 1 })).toMatchObject({ posts: [expect.any(Object)], meta: { provider: "fixture" } });
    vi.stubEnv("NODE_ENV", "production");
    await expect(fetchPosts({ limit: 1 })).rejects.toThrow(/access pending/i);
  });
  it.each([NaN, Infinity, -1, 0, 51, 1.5])("rejects invalid limit %s before any provider call", async limit => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key");
    await expect(fetchPosts({ limit })).rejects.toThrow(/limit/i); expect(paidCall).not.toHaveBeenCalled();
  });
  it("honors aborted collection before any provider or fixture path", async () => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key"); vi.stubEnv("VANTAGE_DEMO_FIXTURES", "true");
    const abort = new AbortController(); abort.abort();
    await expect(fetchPosts({ signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(paidCall).not.toHaveBeenCalled();
  });
  it("sanitizes provider failures instead of logging secrets or leaking fixtures", async () => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key"); const log = vi.spyOn(console, "warn");
    redditSearch.mockRejectedValue(new Error("sk-live-secret")); xSearch.mockRejectedValue(new Error("sk-live-secret"));
    await expect(fetchPosts({ ctx: context })).rejects.toThrow(/provider unavailable/i);
    redditSearch.mockResolvedValue({}); xSearch.mockResolvedValue({});
    await expect(fetchPosts({ ctx: context })).rejects.toThrow(/provider unavailable/i);
    expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
});
