import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { firecrawl, search, fetchPages, agentRun, paidCall, redditSearch, redditPost, redditComments, countToday, reserve } = vi.hoisted(() => ({
  firecrawl: vi.fn(), search: vi.fn(), fetchPages: vi.fn(), agentRun: vi.fn(), paidCall: vi.fn(),
  redditSearch: vi.fn(), redditPost: vi.fn(), redditComments: vi.fn(), countToday: vi.fn(), reserve: vi.fn(),
}));
vi.mock("@/lib/firecrawl/search", async (original) => ({
  ...await original<typeof import("@/lib/firecrawl/search")>(), firecrawlSearch: firecrawl,
}));
vi.mock("@/lib/costs/ledger", async (original) => ({
  ...await original<typeof import("@/lib/costs/ledger")>(), countCostEventsToday: countToday,
  reserveCostAttemptToday: reserve,
}));
vi.mock("scavio", () => ({ Scavio: class {
  reddit = { search: redditSearch, post: redditPost, postComments: redditComments };
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
import type { DocumentRecord } from "@/lib/db/schema";
import { computeFeatures } from "@/lib/opportunities/features";
import { normalizeDocuments } from "@/lib/pipeline/normalize";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";
import { fetchRedditPostsWithMeta, hydrateDailyMax, mapFirecrawlHits, relativeAgeDate } from "@/lib/reddit/client";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const context = { workspaceId: "ws-1", sourceKey: "reddit" };
const thread = (id: string, subreddit = "SaaS") => `https://www.reddit.com/r/${subreddit}/comments/${id}/looking_for_a_tool/`;
const hit = (id: string, extra: Partial<{ title: string; snippet: string; date: string; url: string }> = {}) =>
  ({ url: thread(id), title: `Looking for a tool ${id} : r/SaaS`, snippet: "2 days ago ... any recommendations?", ...extra });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["FIRECRAWL_API_KEY", "SCAVIO_API_KEY", "TINYFISH_API_KEY", "REDDIT_HYDRATE_DAILY_MAX",
    "VANTAGE_DEMO_FIXTURES"]) vi.stubEnv(name, "");
  paidCall.mockImplementation(async (_options, work) => (await work()).value);
  countToday.mockResolvedValue(0);
  let used = 0;
  reserve.mockImplementation(async ({ max }) => max > used && ++used <= max);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("Firecrawl hit mapping", () => {
  it("keeps only Reddit /comments/ threads, once each, without the search-title suffix", () => {
    const posts = mapFirecrawlHits([
      hit("abc1"),
      { url: "https://www.reddit.com/r/SaaS/", title: "r/SaaS - Reddit", snippet: "" },
      { url: "https://www.reddit.com/user/builder/", title: "builder", snippet: "" },
      { url: "https://www.reddit.com/r/SaaS/wiki/index/", title: "Wiki", snippet: "" },
      { url: "https://reddit.com.evil.test/r/SaaS/comments/abc2/x/", title: "Lookalike", snippet: "" },
      { url: "https://example.com/r/SaaS/comments/abc3/x/", title: "Elsewhere", snippet: "" },
      hit("abc1", { url: "https://old.reddit.com/r/SaaS/comments/abc1/other_slug/?utm_source=x", title: "Duplicate" }),
      hit("abc4", { title: "Need a CRM - Reddit" }),
    ], 10, undefined, NOW);
    expect(posts.map(post => [post.id, post.title, post.url])).toEqual([
      ["abc1", "Looking for a tool abc1", thread("abc1")],
      ["abc4", "Need a CRM", thread("abc4")],
    ]);
    expect(posts[0]).toMatchObject({ subreddit: "SaaS", body: "2 days ago ... any recommendations?",
      score: null, numComments: null, contentKind: "preview" });
  });

  it("filters to the targeted subreddit, case-insensitively, and honours the limit", () => {
    const hits = [hit("a1", { url: thread("a1", "startups") }), hit("a2", { url: thread("a2", "saas") }), hit("a3"), hit("a4")];
    expect(mapFirecrawlHits(hits, 10, "SaaS", NOW).map(post => post.id)).toEqual(["a2", "a3", "a4"]);
    expect(mapFirecrawlHits(hits, 2, "SaaS", NOW).map(post => post.id)).toEqual(["a2", "a3"]);
  });

  it("dates a hit from row.date first, then a relative age, and otherwise leaves it empty", () => {
    const [absolute, relativeDate, fromSnippet, none] = mapFirecrawlHits([
      hit("d1", { date: "2026-10-20T08:00:00Z" }),
      hit("d2", { date: "5 hours ago" }),
      hit("d3"),
      hit("d4", { snippet: "Any recommendations for a CRM?" }),
    ], 10, undefined, NOW);
    expect(absolute?.createdAt).toBe("2026-10-20T08:00:00.000Z");
    expect(relativeDate?.createdAt).toBe("2026-10-22T07:00:00.000Z");
    expect(fromSnippet?.createdAt).toBe("2026-10-20T12:00:00.000Z");
    expect(none?.createdAt).toBe("");
  });
});

describe("relative age parsing", () => {
  it.each([
    ["3 days ago", "2026-10-19T12:00:00.000Z"],
    ["2 hours ago — I keep losing leads", "2026-10-22T10:00:00.000Z"],
    ["an hour ago", "2026-10-22T11:00:00.000Z"],
    ["1 week ago", "2026-10-15T12:00:00.000Z"],
    ["  45 mins ago", "2026-10-22T11:15:00.000Z"],
  ])("reads %j", (text, expected) => {
    expect(relativeAgeDate(text, NOW)).toBe(expected);
  });

  it.each(["", "Posted 3 days ago", "yesterday", "3 fortnights ago", "recently"])("ignores %j", text => {
    expect(relativeAgeDate(text, NOW)).toBe("");
  });
});

describe("provider order", () => {
  it("uses Firecrawl first, scoped to the subreddit, with a time filter from the scan lookback", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test"); vi.stubEnv("TINYFISH_API_KEY", "test-key");
    firecrawl.mockResolvedValue([hit("f1")]);
    const result = await fetchRedditPostsWithMeta({ query: "crm", subreddit: "SaaS", limit: 5, lookbackHours: 24, ctx: context });
    expect(result).toMatchObject({ meta: { provider: "firecrawl_search" }, cursor: null, posts: [{ id: "f1", contentKind: "preview" }] });
    expect(firecrawl).toHaveBeenCalledWith("site:reddit.com/r/SaaS crm",
      expect.objectContaining({ limit: 10, tbs: "qdr:d", context }));
    expect(search).not.toHaveBeenCalled();
  });

  it("defaults to a week of results across all of Reddit", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    firecrawl.mockResolvedValue([]);
    expect(await fetchRedditPostsWithMeta({ query: "crm", ctx: context })).toMatchObject({ posts: [], meta: { provider: "firecrawl_search" } });
    expect(firecrawl).toHaveBeenCalledWith("site:reddit.com crm", expect.objectContaining({ limit: 20, tbs: "qdr:w" }));
  });

  it("does not escalate a successful empty Firecrawl search", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test"); vi.stubEnv("TINYFISH_API_KEY", "test-key"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    firecrawl.mockResolvedValue([{ url: "https://www.reddit.com/r/SaaS/", title: "r/SaaS", snippet: "" }]);
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts).toEqual([]);
    expect(search).not.toHaveBeenCalled(); expect(redditSearch).not.toHaveBeenCalled();
  });

  it.each([
    ["an error", new Error("Firecrawl search failed (500)")],
    ["a Firecrawl budget denial", new PaidCallDeniedError("budget_exhausted", "Budget denied")],
  ])("falls back to TinyFish after %s", async (_label, failure) => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test"); vi.stubEnv("TINYFISH_API_KEY", "test-key");
    firecrawl.mockRejectedValue(failure);
    search.mockResolvedValue([{ url: thread("t1"), title: "TinyFish hit", snippet: "Excerpt", position: 1 }]);
    fetchPages.mockResolvedValue([]);
    expect(await fetchRedditPostsWithMeta({ ctx: context })).toMatchObject({ meta: { provider: "tinyfish_search_fetch" }, posts: [{ id: "t1" }] });
  });

  it("keeps the old order behind Firecrawl: TinyFish search, TinyFish Agent, then Scavio", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test"); vi.stubEnv("TINYFISH_API_KEY", "test-key"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    firecrawl.mockRejectedValue(new Error("down")); search.mockRejectedValue(new Error("down")); agentRun.mockRejectedValue(new Error("down"));
    redditSearch.mockResolvedValue({ data: { results: [{ id: "t3_s1", title: "Scavio hit", body: "Text", url: thread("s1") }] } });
    expect(await fetchRedditPostsWithMeta({ ctx: context })).toMatchObject({ meta: { provider: "scavio" }, posts: [{ id: "s1" }] });
    expect([firecrawl, search, agentRun, redditSearch].map(fn => fn.mock.invocationCallOrder[0]))
      .toEqual([...[firecrawl, search, agentRun, redditSearch].map(fn => fn.mock.invocationCallOrder[0])].sort((a, b) => a - b));
  });

  it("stops on cancellation instead of falling back", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test"); vi.stubEnv("TINYFISH_API_KEY", "test-key");
    const abort = new AbortController();
    firecrawl.mockImplementation(async () => { abort.abort(); throw abort.signal.reason; });
    await expect(fetchRedditPostsWithMeta({ ctx: context, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(search).not.toHaveBeenCalled();
  });

  it("retains discovered TinyFish previews when fetching the Reddit pages fails", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key");
    search.mockResolvedValue([{ url: thread("t1"), title: "Synthetic question", snippet: "Literal synthetic excerpt", position: 1 }]);
    fetchPages.mockRejectedValue(new Error("TinyFish fetch failed (503)"));
    const result = await fetchRedditPostsWithMeta({ ctx: context });
    expect(result).toMatchObject({ meta: { provider: "tinyfish_search_fetch" },
      posts: [{ id: "t1", body: "Literal synthetic excerpt", contentKind: "preview" }] });
    expect(agentRun).not.toHaveBeenCalled();
  });

  it.each([
    new DOMException("Cancelled", "AbortError"),
    new PaidCallDeniedError("budget_exhausted", "Budget denied"),
  ])("propagates a TinyFish page-fetch %s instead of falling back", async (failure) => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key");
    search.mockResolvedValue([{ url: thread("t1"), title: "Synthetic question", snippet: "Literal synthetic excerpt", position: 1 }]);
    fetchPages.mockRejectedValue(failure);
    await expect(fetchRedditPostsWithMeta({ ctx: context })).rejects.toBe(failure);
    expect(agentRun).not.toHaveBeenCalled();
  });
});

describe("Scavio hydration", () => {
  const scavioPost = (id: string) => ({ data: { post_id: `t3_${id}`, title: "Full", text: `Full text ${id}`, score: 12, num_comments: 4 } });

  beforeEach(() => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    firecrawl.mockResolvedValue(["h1", "h2", "h3"].map(id => hit(id)));
    redditPost.mockImplementation(async ({ post_id }: { post_id: string }) => scavioPost(post_id.slice(3)));
    redditComments.mockResolvedValue({ data: { comments: [{ body: "Try X", permalink: "/r/SaaS/comments/h1/looking_for_a_tool/c1/" }] } });
  });

  it("hydrates the top posts in search order with full text and top replies, metered per post", async () => {
    const { posts } = await fetchRedditPostsWithMeta({ ctx: context });
    expect(posts.map(post => post.contentKind)).toEqual(["thread", "thread", "thread"]);
    expect(posts[0]).toMatchObject({ body: "Full text h1", score: 12, numComments: 4,
      topComments: [{ text: "Try X", url: "https://www.reddit.com/r/SaaS/comments/h1/looking_for_a_tool/c1/" }] });
    expect(redditPost).toHaveBeenCalledWith({ post_id: "t3_h1" });
    expect(paidCall).toHaveBeenCalledWith(expect.objectContaining({ provider: "scavio", action: "reddit_hydrate",
      estimateUsd: 0.008, context }), expect.any(Function));
    expect(reserve).toHaveBeenCalledWith({ workspaceId: "ws-1", provider: "scavio", action: "reddit_hydrate", max: 5 });
  });

  it("stops at the workspace's daily cap and keeps the rest as previews", async () => {
    reserve.mockReset().mockResolvedValueOnce(true).mockResolvedValue(false);
    const { posts } = await fetchRedditPostsWithMeta({ ctx: context });
    expect(posts.map(post => post.contentKind)).toEqual(["thread", "preview", "preview"]);
    expect(redditPost).toHaveBeenCalledTimes(1);
  });

  it("honours REDDIT_HYDRATE_DAILY_MAX, where 0 turns hydration off", async () => {
    vi.stubEnv("REDDIT_HYDRATE_DAILY_MAX", "2");
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts.map(post => post.contentKind)).toEqual(["thread", "thread", "preview"]);
    vi.stubEnv("REDDIT_HYDRATE_DAILY_MAX", "0"); redditPost.mockClear();
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts.every(post => post.contentKind === "preview")).toBe(true);
    expect(redditPost).not.toHaveBeenCalled();
    expect([undefined, "", "-1", "1.5", "lots"].map(value => hydrateDailyMax({ NODE_ENV: "test", REDDIT_HYDRATE_DAILY_MAX: value }))).toEqual([5, 5, 5, 5, 5]);
  });

  it("keeps the preview when Scavio fails, and carries on with the next post", async () => {
    redditPost.mockRejectedValueOnce(new Error("Scavio 500"));
    const result = await fetchRedditPostsWithMeta({ ctx: context });
    expect(result.meta.provider).toBe("firecrawl_search");
    expect(result.posts[0]).toMatchObject({ id: "h1", contentKind: "preview", body: "2 days ago ... any recommendations?", score: null });
    expect(result.posts[1]).toMatchObject({ id: "h2", contentKind: "thread" });
  });

  it("keeps the post text when only the comments request fails", async () => {
    redditComments.mockRejectedValue(new Error("Scavio 500"));
    const { posts } = await fetchRedditPostsWithMeta({ ctx: context });
    expect(posts[0]).toMatchObject({ contentKind: "thread", body: "Full text h1", topComments: undefined });
  });

  it("rejects a Scavio post that is not the requested thread", async () => {
    redditPost.mockResolvedValue(scavioPost("someoneelse"));
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts.every(post => post.contentKind === "preview")).toBe(true);
  });

  it("stops hydrating on a budget denial or when today's count is unavailable, without failing", async () => {
    paidCall.mockRejectedValue(new PaidCallDeniedError("budget_exhausted", "Budget denied"));
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts).toHaveLength(3);
    expect(paidCall).toHaveBeenCalledTimes(1);

    paidCall.mockReset(); reserve.mockRejectedValue(new Error("db down"));
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts).toHaveLength(3);
    expect(paidCall).not.toHaveBeenCalled();
  });

  it("skips hydration without a Scavio key or workspace attribution", async () => {
    expect((await fetchRedditPostsWithMeta({ ctx: { sourceKey: "reddit" } })).posts.every(post => post.contentKind === "preview")).toBe(true);
    vi.stubEnv("SCAVIO_API_KEY", "");
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts.every(post => post.contentKind === "preview")).toBe(true);
    expect(redditPost).not.toHaveBeenCalled();
  });

  it("prefers the hydrated publication time, retaining the estimate when no exact time is supplied", async () => {
    redditPost.mockResolvedValueOnce({ data: { ...scavioPost("h1").data, createdAt: "2026-10-21T12:34:00Z" } });
    const { posts } = await fetchRedditPostsWithMeta({ ctx: context });
    expect(posts[0].createdAt).toBe("2026-10-21T12:34:00.000Z");
    expect(posts[1].createdAt).not.toBe("");
  });

  it("shares the last hydration slot between overlapping sources", async () => {
    reserve.mockReset().mockResolvedValueOnce(true).mockResolvedValue(false);
    const results = await Promise.all([
      fetchRedditPostsWithMeta({ ctx: context }), fetchRedditPostsWithMeta({ ctx: context }),
    ]);
    expect(redditPost).toHaveBeenCalledTimes(1);
    expect(results.flatMap(result => result.posts).filter(post => post.contentKind === "thread")).toHaveLength(1);
  });
});

describe("preview engagement in documents and scoring", () => {
  it("stores preview votes and comments as unknown, and real counts once hydrated", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test"); vi.stubEnv("SCAVIO_API_KEY", "test-key"); vi.stubEnv("REDDIT_HYDRATE_DAILY_MAX", "1");
    firecrawl.mockResolvedValue([hit("e1"), hit("e2")]);
    redditPost.mockResolvedValue({ data: { post_id: "t3_e1", text: "Full", score: 7, num_comments: 2 } });
    redditComments.mockResolvedValue({ data: { comments: [] } });
    const result = await redditCollector.run({ workspaceId: "ws-1", sourceId: "src-1", config: { lookbackHours: 72 } });
    expect(firecrawl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ tbs: "qdr:w" }));
    expect(result.documents.map(doc => doc.metadata)).toMatchObject([
      { provider: "firecrawl_search", contentKind: "thread", discoveryOnly: false, score: 7, numComments: 2, engagementKnown: true },
      { provider: "firecrawl_search", contentKind: "preview", discoveryOnly: true, score: null, numComments: null, engagementKnown: false },
    ]);
  });

  it("scores a preview the same whatever its engagement fields say", () => {
    const base = { id: "doc-1", workspaceId: "ws-1", sourceId: "src-1", urlCanonical: thread("s1"), platform: "reddit",
      authorRef: null, title: "Looking for a CRM", contentMd: "Any recommendations for a CRM for a small team?",
      contentHash: "h", rawSnapshotRef: null, postedAt: new Date(NOW), collectedAt: new Date(NOW) };
    const features = (metadata: Record<string, unknown>) =>
      computeFeatures(normalizeDocuments([{ ...base, metadata } as unknown as DocumentRecord]),
        { productDescription: "CRM for small teams", topics: ["crm"], competitors: [] });
    // Timing decays with the clock, so pin it: both calls must see the same "now".
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW + 3_600_000);
    try {
      expect(features({ score: null, numComments: null, engagementKnown: false }))
        .toEqual(features({ score: 950, numComments: 300, engagementKnown: true }));
    } finally { vi.useRealTimers(); }
  });
});
