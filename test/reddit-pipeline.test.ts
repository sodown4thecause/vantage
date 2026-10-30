import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { firecrawl, linkup, search, paidCall, redditPost, redditComments, redditSearch, reserve } = vi.hoisted(() => ({
  firecrawl: vi.fn(), linkup: vi.fn(), search: vi.fn(), paidCall: vi.fn(),
  redditPost: vi.fn(), redditComments: vi.fn(), redditSearch: vi.fn(), reserve: vi.fn(),
}));
vi.mock("@/lib/firecrawl/search", async (original) => ({
  ...await original<typeof import("@/lib/firecrawl/search")>(), firecrawlSearch: firecrawl,
}));
vi.mock("@/lib/linkup/search", async (original) => ({
  ...await original<typeof import("@/lib/linkup/search")>(), linkupSearch: linkup,
}));
vi.mock("@/lib/costs/ledger", async (original) => ({
  ...await original<typeof import("@/lib/costs/ledger")>(), reserveCostAttemptToday: reserve,
}));
vi.mock("scavio", () => ({ Scavio: class {
  reddit = { search: redditSearch, post: redditPost, postComments: redditComments };
} }));
vi.mock("@/lib/tinyfish/search-fetch", () => ({ tinyFishSearch: search, tinyFishFetchMarkdown: vi.fn() }));
vi.mock("@/lib/tinyfish/client", () => ({
  hasTinyFishApiKey: () => Boolean(process.env.TINYFISH_API_KEY?.trim()),
  createTinyFishClient: () => ({ agent: { run: vi.fn() } }),
}));
vi.mock("@/lib/providers/paid-call", () => {
  class PaidCallDeniedError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return { runPaidCall: paidCall, PaidCallDeniedError,
    isPaidCallDenied: (error: unknown) => error instanceof PaidCallDeniedError };
});

import { redditCollector } from "@/lib/collectors/reddit";
import { linkupFromDate } from "@/lib/linkup/search";
import { contentKindLabel, parseContentKind } from "@/lib/opportunities/content-kind";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";
import { fetchRedditPostsWithMeta, linkupDailyMax, linkupLaneEnabled, shouldHydrate, type RedditPost } from "@/lib/reddit/client";
import { dropBotPosts, isBotAuthor, runRedditPipeline } from "@/lib/reddit/pipeline";

const context = { workspaceId: "ws-1", sourceKey: "reddit" };
const thread = (id: string, subreddit = "SaaS") => `https://www.reddit.com/r/${subreddit}/comments/${id}/looking_for_a_tool/`;
const hit = (id: string, snippet = "2 days ago ... any recommendations?") =>
  ({ url: thread(id), title: `Looking for a tool ${id}`, snippet });
const LONG = "We are a five-person agency and keep losing leads between the inbox and the spreadsheet. ".repeat(3);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["FIRECRAWL_API_KEY", "SCAVIO_API_KEY", "TINYFISH_API_KEY", "LINKUP_API_KEY", "REDDIT_LINKUP_LANE",
    "REDDIT_LINKUP_DAILY_MAX", "REDDIT_HYDRATE_DAILY_MAX", "VANTAGE_DEMO_FIXTURES"]) vi.stubEnv(name, "");
  paidCall.mockImplementation(async (_options, work) => (await work()).value);
  reserve.mockImplementation(async ({ max }: { max: number }) => max > 0);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("bot filter", () => {
  it.each(["AutoModerator", "automoderator", "u/AutoModerator", "RemindMeBot", "sneakpeek_bot", "some-bot", "HELPER_BOT", "SaveVideo"])(
    "treats %j as a bot", author => { expect(isBotAuthor(author)).toBe(true); });

  it.each([undefined, "", "Abbot", "talbot", "botanist_jane", "builder42"])("treats %j as a person", author => {
    expect(isBotAuthor(author)).toBe(false);
  });

  it("runs enrichers before filters, so an author found by an enricher is filtered", async () => {
    const post = { id: "p1", title: "t", body: "b", url: thread("p1"), score: null, numComments: null, createdAt: "" } satisfies RedditPost;
    const posts = await runRedditPipeline([post, { ...post, id: "p2" }],
      [async rows => rows.map(row => row.id === "p1" ? { ...row, author: "AutoModerator" } : row)], [dropBotPosts]);
    expect(posts.map(row => row.id)).toEqual(["p2"]);
  });

  it("drops AutoModerator posts and bot replies before the collector builds documents", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    firecrawl.mockResolvedValue([hit("b1"), hit("b2")]);
    redditPost.mockImplementation(async ({ post_id }: { post_id: string }) => ({ data: { post_id, text: "Full text",
      author: post_id === "t3_b1" ? "AutoModerator" : "founder_jane" } }));
    redditComments.mockResolvedValue({ data: { comments: [
      { body: "I am a bot, beep", author: "AutoModerator" }, { body: "Try X", author: "real_person" }] } });
    const result = await redditCollector.run({ workspaceId: "ws-1", sourceId: "src-1", config: {} });
    expect(result.documents.map(doc => [doc.rawSnapshotRef, doc.authorRef])).toEqual([["reddit:b2", "founder_jane"]]);
    expect(result.documents[0]?.metadata).toMatchObject({ topComments: [{ text: "Try X" }] });
  });
});

describe("hydration eligibility", () => {
  it.each(["https://example.com/article", "https://youtu.be/abc"])("preserves hydrated outbound links in collector metadata: %s", async url => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    vi.stubEnv("SCAVIO_API_KEY", "test-key");
    firecrawl.mockResolvedValue([hit("r1", "")]);
    redditPost.mockResolvedValue({ data: { post_id: "t3_r1", selftext: "", url } });
    redditComments.mockResolvedValue({ data: { comments: [] } });
    const result = await redditCollector.run({ workspaceId: "ws-1", sourceId: "src-1", config: {} });
    expect(result.documents[0]).toMatchObject({ urlCanonical: thread("r1"), metadata: { outboundUrl: url } });
  });

  it("preserves outbound links from Scavio search separately from the thread URL", async () => {
    vi.stubEnv("SCAVIO_API_KEY", "test-key");
    redditSearch.mockResolvedValue({ data: { posts: [{
      id: "r1", title: "News", permalink: thread("r1"), url: "https://example.com/article",
    }] } });
    const result = await redditCollector.run({ workspaceId: "ws-1", sourceId: "src-1", config: {} });
    expect(result.documents[0]).toMatchObject({ urlCanonical: thread("r1"), metadata: { outboundUrl: "https://example.com/article" } });
  });

  const preview = (body: string): RedditPost =>
    ({ id: "x", title: "t", body, url: thread("x"), score: null, numComments: null, createdAt: "", contentKind: "preview" });

  it("hydrates top-ranked previews and short snippets only", () => {
    expect(shouldHydrate(preview(LONG), 0)).toBe(true);
    expect(shouldHydrate(preview(LONG), 2)).toBe(true);
    expect(shouldHydrate(preview(LONG), 3)).toBe(false);
    expect(shouldHydrate(preview("Any CRM recommendations?"), 9)).toBe(true);
    expect(shouldHydrate({ ...preview(""), contentKind: "thread" }, 0)).toBe(false);
  });

  it("spends the daily cap on eligible posts, skipping long snippets below the top three", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test"); vi.stubEnv("SCAVIO_API_KEY", "test-key");
    firecrawl.mockResolvedValue([hit("r1", LONG), hit("r2", LONG), hit("r3", LONG), hit("r4", LONG), hit("r5", "short")]);
    redditPost.mockImplementation(async ({ post_id }: { post_id: string }) => ({ data: { post_id, text: `Full ${post_id}` } }));
    redditComments.mockResolvedValue({ data: { comments: [] } });
    const { posts } = await fetchRedditPostsWithMeta({ ctx: context });
    expect(posts.map(post => post.contentKind)).toEqual(["thread", "thread", "thread", "preview", "thread"]);
    expect(redditPost).toHaveBeenCalledTimes(4);
    expect(paidCall).toHaveBeenCalledTimes(4);
  });
});

describe("Linkup discovery lane", () => {
  beforeEach(() => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test"); vi.stubEnv("LINKUP_API_KEY", "lk-test"); vi.stubEnv("REDDIT_LINKUP_LANE", "true");
  });

  it("is off unless both the flag and the key are set", () => {
    expect(linkupLaneEnabled()).toBe(true);
    expect(linkupLaneEnabled({ NODE_ENV: "test", LINKUP_API_KEY: "lk-test" })).toBe(false);
    expect(linkupLaneEnabled({ NODE_ENV: "test", REDDIT_LINKUP_LANE: "true" })).toBe(false);
    expect([undefined, "", "0", "-1", "lots"].map(value => linkupDailyMax({ NODE_ENV: "test", REDDIT_LINKUP_DAILY_MAX: value })))
      .toEqual([20, 20, 0, 20, 20]);
  });

  it("merges after Firecrawl, keeps only Reddit threads, dedupes by id and labels its own posts", async () => {
    firecrawl.mockResolvedValue([hit("m1")]);
    linkup.mockResolvedValue([
      { url: thread("m1"), title: "Duplicate", snippet: "dup" },
      { url: "https://news.ycombinator.com/item?id=1", title: "Ask HN: CRMs?", snippet: "hn" },
      { url: thread("m2"), title: "Linkup only", snippet: "Any CRM recommendations?" },
    ]);
    const result = await fetchRedditPostsWithMeta({ query: "crm", lookbackHours: 48, ctx: context });
    expect(result.meta.provider).toBe("firecrawl_search");
    expect(result.posts.map(post => [post.id, post.provider])).toEqual([["m1", undefined], ["m2", "linkup_search"]]);
    expect(linkup).toHaveBeenCalledWith("crm", expect.objectContaining({ includeDomains: ["reddit.com", "news.ycombinator.com"],
      fromDate: linkupFromDate(48), context }));
    expect(reserve).toHaveBeenCalledWith({ workspaceId: "ws-1", provider: "linkup", action: "search", max: 20 });
  });

  it("carries Linkup provenance into the document", async () => {
    firecrawl.mockResolvedValue([]);
    linkup.mockResolvedValue([{ url: thread("d1"), title: "Linkup only", snippet: "Any CRM recommendations?" }]);
    const result = await redditCollector.run({ workspaceId: "ws-1", sourceId: "src-1", config: {} });
    expect(result.documents[0]?.metadata).toMatchObject({ provider: "linkup_search", contentKind: "preview", engagementKnown: false });
  });

  it("serves alone when Firecrawl fails, before the older providers", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key");
    firecrawl.mockRejectedValue(new PaidCallDeniedError("budget_exhausted", "Budget denied"));
    linkup.mockResolvedValue([{ url: thread("l1"), title: "Linkup", snippet: "s" }]);
    expect(await fetchRedditPostsWithMeta({ ctx: context })).toMatchObject({ meta: { provider: "linkup_search" }, posts: [{ id: "l1" }] });
    expect(search).not.toHaveBeenCalled();
  });

  it("does not search once the workspace has used today's Linkup cap", async () => {
    vi.stubEnv("REDDIT_LINKUP_DAILY_MAX", "2");
    reserve.mockResolvedValue(false);
    firecrawl.mockResolvedValue([hit("c1")]);
    expect((await fetchRedditPostsWithMeta({ ctx: context })).posts.map(post => post.id)).toEqual(["c1"]);
    expect(linkup).not.toHaveBeenCalled();
  });

  it("falls back to TinyFish when every discovery lane fails", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key");
    firecrawl.mockRejectedValue(new Error("down")); linkup.mockRejectedValue(new Error("Linkup search failed (500)"));
    search.mockResolvedValue([]);
    expect((await fetchRedditPostsWithMeta({ ctx: context })).meta.provider).toBe("tinyfish_search_fetch");
  });

  it.each(["cap", "reservation failure", "disabled cap"])("falls back after a Linkup %s when Firecrawl fails", async reason => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key");
    firecrawl.mockRejectedValue(new Error("down"));
    if (reason === "reservation failure") reserve.mockRejectedValue(new Error("db down"));
    else if (reason === "disabled cap") vi.stubEnv("REDDIT_LINKUP_DAILY_MAX", "0");
    else reserve.mockResolvedValue(false);
    search.mockResolvedValue([]);
    expect((await fetchRedditPostsWithMeta({ ctx: context })).meta.provider).toBe("tinyfish_search_fetch");
    expect(linkup).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledOnce();
  });

  it("admits only one overlapping source when one Linkup slot remains", async () => {
    vi.stubEnv("REDDIT_LINKUP_DAILY_MAX", "2");
    let attempts = 1;
    reserve.mockImplementation(async ({ max }: { max: number }) => attempts < max && Boolean(++attempts));
    firecrawl.mockResolvedValue([hit("f1")]);
    let finishSearch!: (hits: ReturnType<typeof hit>[]) => void;
    linkup.mockImplementation(() => new Promise(resolve => { finishSearch = resolve; }));
    const sources = [fetchRedditPostsWithMeta({ ctx: context }), fetchRedditPostsWithMeta({ ctx: context })];
    await vi.waitFor(() => expect(linkup).toHaveBeenCalledOnce());
    finishSearch([hit("l1")]);
    const results = await Promise.all(sources);
    expect(results.map(result => result.posts.map(post => post.id))).toEqual([["f1", "l1"], ["f1"]]);
    expect(linkup).toHaveBeenCalledOnce();
    expect(reserve.mock.calls.map(([input]) => input)).toEqual([
      { workspaceId: "ws-1", provider: "linkup", action: "search", max: 2 },
      { workspaceId: "ws-1", provider: "linkup", action: "search", max: 2 },
    ]);
  });

  it("denies Linkup without a workspace before reserving or searching", async () => {
    firecrawl.mockResolvedValue([hit("f1")]);
    expect((await fetchRedditPostsWithMeta()).posts.map(post => post.id)).toEqual(["f1"]);
    expect(reserve).not.toHaveBeenCalled();
    expect(linkup).not.toHaveBeenCalled();
  });
});

describe("Linkup request", () => {
  it("uses the shared required-binding error before spending when its key is absent", async () => {
    const { linkupSearch } = await vi.importActual<typeof import("@/lib/linkup/search")>("@/lib/linkup/search");
    await expect(linkupSearch("crm", { maxResults: 1, context }))
      .rejects.toThrow("Required environment variable LINKUP_API_KEY is not configured");
    expect(paidCall).not.toHaveBeenCalled();
  });
  it("asks for fast search results from the lookback date, metered at $0.005", async () => {
    const { linkupSearch } = await vi.importActual<typeof import("@/lib/linkup/search")>("@/lib/linkup/search");
    vi.stubEnv("LINKUP_API_KEY", "lk-test");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [
      { type: "text", name: "Ask HN", url: "https://news.ycombinator.com/item?id=1", content: "text" }, { name: "no url" }] })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const hits = await linkupSearch("crm", { maxResults: 40, includeDomains: ["reddit.com"], fromDate: "2026-10-16", context });
      expect(hits).toEqual([{ url: "https://news.ycombinator.com/item?id=1", title: "Ask HN", snippet: "text" }]);
      expect(paidCall).toHaveBeenCalledWith(expect.objectContaining({ provider: "linkup", action: "search", estimateUsd: 0.005 }), expect.any(Function));
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({ q: "crm", depth: "fast", outputType: "searchResults", maxResults: 20,
        includeDomains: ["reddit.com"], fromDate: "2026-10-16" });
    } finally { vi.unstubAllGlobals(); }
  });

  it("dates the lookback in UTC", () => {
    expect(linkupFromDate(168, Date.parse("2026-10-23T01:00:00Z"))).toBe("2026-10-16");
  });
});

describe("provenance label", () => {
  it.each([
    ["preview", "Search snippet only"], ["page_excerpt", "Page excerpt"], ["thread", "Full thread"], ["other", null], [undefined, null],
  ])("labels %j", (raw, label) => { expect(contentKindLabel(parseContentKind(raw))).toBe(label); });
});
