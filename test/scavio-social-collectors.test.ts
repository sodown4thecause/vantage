import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redditSearch = vi.fn();
const xSearch = vi.fn();

vi.mock("@/lib/providers/paid-call", () => ({
  runPaidCall: async (_options: unknown, work: () => Promise<{ value: unknown }>) => (await work()).value,
  isPaidCallDenied: () => false,
}));

vi.mock("scavio", () => {
  class Scavio {
    reddit = { search: redditSearch };
    x = { search: xSearch };
  }
  return { Scavio };
});

import { redditCollector } from "@/lib/collectors/reddit";
import { xCollector } from "@/lib/collectors/x";
import { fetchRedditPostsWithMeta } from "@/lib/reddit/client";
import { fetchXPostsWithMeta } from "@/lib/x/client";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  redditSearch.mockReset();
  xSearch.mockReset();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SCAVIO_API_KEY;
  delete process.env.TINYFISH_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.X_GATEWAY_EXPERIMENT_ENABLED;
  delete process.env.VANTAGE_DEMO_FIXTURES;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("Reddit Scavio client", () => {
  it("uses Scavio search when SCAVIO_API_KEY is set", async () => {
    process.env.SCAVIO_API_KEY = "sk_test";
    redditSearch.mockResolvedValue({
      data: {
        results: [
          {
            post_id: "t3_abc",
            title: "Free social listening?",
            selftext: "Need HN + Reddit alerts",
            url: "https://www.reddit.com/r/SaaS/comments/abc/free/",
            author: "indie",
            subreddit: "SaaS",
            score: 10,
            num_comments: 4,
          },
        ],
        next_cursor: "cur-1",
      },
    });

    const { posts, meta, cursor } = await fetchRedditPostsWithMeta({
      query: "social listening",
      limit: 5,
    });

    expect(meta.provider).toBe("scavio");
    expect(posts[0]?.title).toContain("social listening");
    expect(cursor).toBe("cur-1");
    expect(redditSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "social listening" }),
    );
  });

  it("uses fixtures only with explicit demo opt-in", async () => {
    process.env.VANTAGE_DEMO_FIXTURES = "true";
    const { posts, meta } = await fetchRedditPostsWithMeta({ limit: 1 });
    expect(meta.provider).toBe("fixture");
    expect(posts.length).toBe(1);
  });
});

describe("X Scavio client", () => {
  it("uses Scavio search when SCAVIO_API_KEY is set", async () => {
    process.env.SCAVIO_API_KEY = "sk_test";
    xSearch.mockResolvedValue({
      data: {
        results: [
          {
            id: "123",
            text: "Looking for Brandwatch alternatives",
            username: "builder",
            url: "https://x.com/builder/status/123",
            created_at: "2026-10-06T12:00:00Z",
            like_count: 5,
          },
        ],
      },
    });

    const { posts, meta } = await fetchXPostsWithMeta({
      query: "Brandwatch alternative",
      searchType: "Latest",
    });

    expect(meta.provider).toBe("scavio");
    expect(posts[0]?.text).toContain("Brandwatch");
    expect(xSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "Brandwatch alternative",
        search_type: "Latest",
      }),
    );
  });
});

describe("social collectors", () => {
  it("marks reddit documents with scavio provider", async () => {
    process.env.SCAVIO_API_KEY = "sk_test";
    redditSearch.mockResolvedValue({
      results: [
        {
          id: "t3_1",
          title: "Hello",
          body: "World",
          url: "https://www.reddit.com/r/test/comments/1/hello/",
          author: "u1",
          subreddit: "test",
        },
      ],
    });

    const result = await redditCollector.run({
      workspaceId: "ws-1",
      sourceId: "src-1",
      config: { query: "hello" },
    });

    expect(result.documents[0]?.platform).toBe("reddit");
    expect(result.documents[0]?.metadata).toMatchObject({
      provider: "scavio",
      mocked: false,
    });
  });

  it("marks x documents with scavio provider", async () => {
    process.env.SCAVIO_API_KEY = "sk_test";
    xSearch.mockResolvedValue({
      results: [
        {
          id: "99",
          text: "shipping social listening",
          author: "ops",
          url: "https://x.com/ops/status/99",
          created_at: "2026-10-06T12:00:00Z",
        },
      ],
    });

    const result = await xCollector.run({
      workspaceId: "ws-1",
      sourceId: "src-1",
      config: { query: "social listening" },
    });

    expect(result.documents[0]?.platform).toBe("x");
    expect(result.documents[0]?.metadata).toMatchObject({
      provider: "scavio",
      mocked: false,
    });
  });
});
