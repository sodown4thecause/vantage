import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchQuery = vi.fn();
const fetchGetContents = vi.fn();
const browserMarkdown = vi.fn();
const paid = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], deny: false }));

vi.mock("@tiny-fish/sdk", () => {
  class TinyFish {
    search = { query: searchQuery };
    fetch = { getContents: fetchGetContents };
  }
  return { TinyFish };
});
vi.mock("@/lib/costs/ledger", () => ({ recordCost: async () => {} }));
vi.mock("@/lib/costs/prices", () => ({ getUnitCost: async () => 0 }));
vi.mock("@/lib/providers/paid-call", () => {
  class PaidCallDeniedError extends Error {}
  return {
    PaidCallDeniedError,
    isPaidCallDenied: (error: unknown) => error instanceof PaidCallDeniedError,
    runPaidCall: async (meta: Record<string, unknown>, work: () => Promise<{ value: unknown }>) => {
      paid.calls.push(meta);
      if (paid.deny) throw new PaidCallDeniedError("Paid providers are disabled.");
      return (await work()).value;
    },
  };
});
vi.mock("@/lib/browser/run", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/browser/run")>(),
  browserMarkdown: (...args: unknown[]) => browserMarkdown(...args),
}));

import { BrowserRunError } from "@/lib/browser/run";
import { withFirstScanBudget } from "@/lib/activation/budget";
import { collectorsByType } from "@/lib/collectors/registry";
import { webDiscussionsCollector } from "@/lib/collectors/web-discussions";

const NOW = new Date("2026-10-13T00:00:00Z");
const ctx = (config: Record<string, unknown>, cursor: string | null = null) => ({
  workspaceId: "ws-1", sourceId: "src-1", cursor,
  config: { provider: "tinyfish-web", queries: ["social listening"], ...config },
});
const hit = (url: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ url, title, snippet: `${title} snippet`, position: 1, site_name: "x", ...extra });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  searchQuery.mockReset(); fetchGetContents.mockReset(); browserMarkdown.mockReset();
  paid.calls = []; paid.deny = false;
  vi.stubEnv("TINYFISH_API_KEY", "tf-key");
  vi.stubEnv("FIRECRAWL_API_KEY", "");
  fetchGetContents.mockResolvedValue({ results: [] });
  browserMarkdown.mockRejectedValue(new BrowserRunError("binding_missing", "Browser Run is not configured."));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("webDiscussionsCollector", () => {
  it("finds forum threads and blog posts, reading page text and skipping the owner's own site", async () => {
    searchQuery.mockImplementation(async (params: Record<string, unknown>) => params.include_domains
      ? { results: [
        hit("https://www.indiehackers.com/post/how-do-you-find-first-customers-abc?utm_source=x#c1", "How do you find first customers?", { date: "2026-10-11" }),
        hit("https://dev.to/someone/social-listening-tools-2026", "Social listening tools I tried"),
        hit("https://example-blog.com/not-a-forum", "Wrong domain for a forum search"),
      ] }
      : { results: [
        hit("https://growthnotes.io/blog/reddit-lead-gen", "Reddit lead generation without spam", { date: "2026-10-10" }),
        hit("https://contextfor.dev/blog/find-customers-on-reddit-without-spamming", "Our own post"),
        hit("https://www.reddit.com/r/SaaS/comments/abc/x/", "A Reddit thread is not a blog"),
        hit("https://growthnotes.io/", "Home page"),
      ] });
    fetchGetContents.mockResolvedValue({ results: [
      { url: "https://www.indiehackers.com/post/how-do-you-find-first-customers-abc", text: "I launched last month and need my first 10 customers." },
    ] });

    const result = await webDiscussionsCollector.run(ctx({ excludeHosts: ["contextfor.dev"] }));

    const forumCall = searchQuery.mock.calls.find(([p]) => p.include_domains)![0];
    expect(forumCall.include_domains).toContain("indiehackers.com");
    expect(forumCall.after_date).toBe("2026-10-06");
    const blogCall = searchQuery.mock.calls.find(([p]) => p.exclude_domains)![0];
    expect(blogCall.exclude_domains.split(",")).toEqual(expect.arrayContaining(["reddit.com", "dev.to", "contextfor.dev"]));
    expect(result.documents.map(d => [d.platform, d.urlCanonical])).toEqual([
      ["forum", "https://www.indiehackers.com/post/how-do-you-find-first-customers-abc"],
      ["forum", "https://dev.to/someone/social-listening-tools-2026"],
      ["blog", "https://growthnotes.io/blog/reddit-lead-gen"],
    ]);
    const [ih, devto, blog] = result.documents;
    expect(ih.contentMd).toContain("first 10 customers");
    expect(ih.metadata).toMatchObject({ provider: "tinyfish_search_fetch", mocked: false, site: "indiehackers.com",
      contentKind: "page_excerpt", reader: "tinyfish_fetch", venueKind: "forum" });
    expect(ih.postedAt?.toISOString()).toBe("2026-10-11T00:00:00.000Z");
    expect(devto.metadata).toMatchObject({ contentKind: "preview", discoveryOnly: true, publicationDateMissing: true });
    expect(blog.metadata).toMatchObject({ site: "growthnotes.io", venueKind: "blog" });
    expect(result.partial).toBe(true);
    expect(result.coverageReason).toMatch(/snippets only/);
    expect(result.nextState?.cursor).toBe(NOW.toISOString());
  });

  it("drops results older than the window and resumes a day before the saved cursor", async () => {
    searchQuery.mockResolvedValue({ results: [
      hit("https://dev.to/a/old-post", "Old", { date: "2026-09-01" }),
      hit("https://dev.to/a/new-post", "New", { date: "2026-10-12" }),
    ] });
    const result = await webDiscussionsCollector.run(ctx({ kinds: ["forum"] }, "2026-10-12T12:00:00Z"));
    expect(searchQuery.mock.calls[0][0].after_date).toBe("2026-10-11");
    expect(result.documents.map(d => d.title)).toEqual(["New"]);
  });

  it("keeps every known forum out of blog results, even forums outside this source's own pack", async () => {
    searchQuery.mockImplementation(async (params: Record<string, unknown>) => params.exclude_domains
      ? { results: [
        hit("https://community.shopify.com/c/shopify-discussion/store-owners-thread", "Store owners thread on a forum"),
        hit("https://growthnotes.io/blog/store-owner-lead-gen", "Lead generation for store owners"),
      ] }
      : { results: [] });

    const result = await webDiscussionsCollector.run(ctx({ kinds: ["blog"],
      forumDomains: ["community.hubspot.com", "warriorforum.com", "webmasterworld.com", "indiehackers.com"] }));

    const blogCall = searchQuery.mock.calls.find(([p]) => p.exclude_domains)![0];
    expect(blogCall.exclude_domains.split(",")).toEqual(expect.arrayContaining(["community.shopify.com", "dev.to", "reddit.com"]));
    expect(result.documents.map(d => d.urlCanonical)).toEqual(["https://growthnotes.io/blog/store-owner-lead-gen"]);
    expect(result.documents[0].platform).toBe("blog");
  });

  it("shares the result limit between forums and blogs", async () => {
    searchQuery.mockImplementation(async (params: Record<string, unknown>) => ({ results: Array.from({ length: 8 }, (_, i) =>
      params.include_domains ? hit(`https://dev.to/a/post-${i}`, `Forum ${i}`) : hit(`https://blog${i}.io/post`, `Blog ${i}`)) }));
    const result = await webDiscussionsCollector.run(ctx({ maxResults: 6 }));
    expect(result.documents.filter(d => d.platform === "forum")).toHaveLength(3);
    expect(result.documents.filter(d => d.platform === "blog")).toHaveLength(3);
  });

  it("renders unread pages with Cloudflare Browser Run", async () => {
    searchQuery.mockResolvedValue({ results: [hit("https://dev.to/a/thread", "Thread")] });
    fetchGetContents.mockRejectedValue(new Error("fetch down"));
    browserMarkdown.mockResolvedValue({ markdown: "Rendered thread body", ms: 900 });
    const [document] = (await webDiscussionsCollector.run(ctx({ kinds: ["forum"] }))).documents;
    expect(browserMarkdown).toHaveBeenCalledWith("https://dev.to/a/thread", expect.objectContaining({ workspaceId: "ws-1" }));
    expect(document.contentMd).toBe("Rendered thread body");
    expect(document.metadata).toMatchObject({ reader: "cloudflare_browser_run", contentKind: "page_excerpt" });
  });

  it("falls back to Firecrawl search when TinyFish search fails", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-key");
    vi.stubEnv("FIRECRAWL_CREDIT_USD", "0.001");
    searchQuery.mockRejectedValue(new Error("tinyfish down"));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ sources: ["web"], tbs: "qdr:w", includeDomains: expect.arrayContaining(["dev.to"]) });
      expect(body).not.toHaveProperty("excludeDomains");
      return new Response(JSON.stringify({ success: true, creditsUsed: 2,
        data: { web: [{ url: "https://dev.to/a/fc", title: "From Firecrawl", description: "snippet" }] } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await webDiscussionsCollector.run(ctx({ kinds: ["forum"] }));
    expect(fetchMock).toHaveBeenCalledWith("https://api.firecrawl.dev/v2/search", expect.anything());
    expect(paid.calls[0]).toMatchObject({ provider: "firecrawl", action: "search" });
    expect(result.documents[0].metadata).toMatchObject({ provider: "firecrawl_search" });
  });

  it("reports a denied Firecrawl fallback instead of pretending the search was empty", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-key");
    vi.stubEnv("FIRECRAWL_CREDIT_USD", "0.001");
    paid.deny = true;
    searchQuery.mockRejectedValue(new Error("tinyfish down"));
    await expect(webDiscussionsCollector.run(ctx({ kinds: ["forum"] }))).rejects.toThrow(/paid-provider opt-in/);
  });

  it("never dispatches TinyFish in a manual scan and reports missing metered coverage", async () => {
    await expect(withFirstScanBudget("ws-1", "chat-test", () => webDiscussionsCollector.run(ctx({ kinds: ["forum"] })), false))
      .rejects.toThrow(/Access pending|unavailable/);
    expect(searchQuery).not.toHaveBeenCalled();
    expect(fetchGetContents).not.toHaveBeenCalled();
  });

  it("uses only the metered Firecrawl path for manual forum coverage", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-key");
    vi.stubEnv("FIRECRAWL_CREDIT_USD", "0.001");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, creditsUsed: 2,
      data: { web: [{ url: "https://dev.to/a/fc", title: "From Firecrawl", description: "snippet" }] } }))));
    const result = await withFirstScanBudget("ws-1", "chat-test", () => webDiscussionsCollector.run(ctx({ kinds: ["forum"] })), false);
    expect(searchQuery).not.toHaveBeenCalled();
    expect(browserMarkdown).not.toHaveBeenCalled();
    expect(paid.calls).toEqual([expect.objectContaining({ provider: "firecrawl", action: "search" })]);
    expect(result.documents).toHaveLength(1);
  });

  it("keeps partial results when only some searches fail", async () => {
    searchQuery.mockImplementation(async (params: Record<string, unknown>) => {
      if (params.include_domains) throw new Error("forum search down");
      return { results: [hit("https://blog.io/post", "Blog post", { date: "2026-10-12" })] };
    });
    const result = await webDiscussionsCollector.run(ctx({}));
    expect(result.documents).toHaveLength(1);
    expect(result.coverageReason).toMatch(/1 of 2 searches failed/);
  });

  it("needs credentials and a search phrase", async () => {
    await expect(webDiscussionsCollector.run(ctx({ queries: [] }))).rejects.toThrow(/search phrase/);
    vi.stubEnv("TINYFISH_API_KEY", "");
    await expect(webDiscussionsCollector.run(ctx({}))).rejects.toThrow(/Access pending/);
  });

  it("propagates aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(webDiscussionsCollector.run({ ...ctx({}), signal: controller.signal })).rejects.toThrow();
    expect(searchQuery).not.toHaveBeenCalled();
  });

  it("is what a web_search source with the tinyfish-web provider runs; other providers stay on Alexandria", async () => {
    searchQuery.mockResolvedValue({ results: [] });
    await collectorsByType.web_search!.run(ctx({ kinds: ["forum"] }));
    expect(searchQuery).toHaveBeenCalledOnce();
    await expect(collectorsByType.web_search!.run({ ...ctx({}), config: { provider: "arbitrary" } })).rejects.toThrow(/allowlist|not supported/i);
  });
});
