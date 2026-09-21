import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agentRun = vi.fn();
const searchQuery = vi.fn();
const fetchGetContents = vi.fn();
const youtubeComments = vi.fn();

vi.mock("@tiny-fish/sdk", () => {
  class TinyFish {
    agent = { run: agentRun };
    search = { query: searchQuery };
    fetch = { getContents: fetchGetContents };
  }
  return { TinyFish };
});

vi.mock("scavio", () => {
  class Scavio {
    youtube = { comments: youtubeComments };
  }
  return { Scavio };
});

import {
  normalizeAgentResult,
  runTinyFishStructuredAgent,
} from "@/lib/tinyfish/agent";
import { fetchProductHuntPostsWithMeta } from "@/lib/producthunt/client";
import { fetchYouTubeCommentsWithMeta } from "@/lib/youtube/client";
import { productHuntCollector } from "@/lib/collectors/producthunt";
import { youtubeCollector } from "@/lib/collectors/youtube";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  agentRun.mockReset();
  searchQuery.mockReset();
  fetchGetContents.mockReset();
  youtubeComments.mockReset();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.TINYFISH_API_KEY;
  delete process.env.SCAVIO_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.PH_DEV_TOKEN;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("normalizeAgentResult", () => {
  it("parses JSON strings and objects", () => {
    expect(normalizeAgentResult({ a: 1 })).toEqual({ a: 1 });
    expect(normalizeAgentResult('{"posts":[]}')).toEqual({ posts: [] });
    expect(normalizeAgentResult(null)).toBeNull();
  });
});

describe("runTinyFishStructuredAgent", () => {
  it("returns structured result on COMPLETED runs", async () => {
    process.env.TINYFISH_API_KEY = "sk-tinyfish-test";
    agentRun.mockResolvedValue({
      status: "COMPLETED",
      run_id: "run-1",
      result: { comments: [] },
      error: null,
    });

    const result = await runTinyFishStructuredAgent({
      url: "https://www.youtube.com/watch?v=abc",
      goal: "extract",
      outputSchema: { type: "object" },
    });

    expect(result).toEqual({ comments: [] });
  });
});

describe("YouTube provider order", () => {
  it("prefers Scavio comments scrape over TinyFish agent", async () => {
    process.env.SCAVIO_API_KEY = "sk_test";
    process.env.TINYFISH_API_KEY = "sk-tinyfish-test";
    youtubeComments.mockResolvedValue({
      comments: [
        {
          id: "c1",
          author: "alice",
          text: "Need social listening",
          video_id: "vid-abc",
        },
      ],
    });

    const { comments, meta } = await fetchYouTubeCommentsWithMeta({
      videoIds: ["vid-abc"],
    });

    expect(meta.provider).toBe("scavio");
    expect(comments[0]?.author).toBe("alice");
    expect(agentRun).not.toHaveBeenCalled();
  });

  it("uses TinyFish fetch before agent when only TinyFish is configured", async () => {
    process.env.TINYFISH_API_KEY = "sk-tinyfish-test";
fetchGetContents.mockResolvedValue({
      results: [
        {
          url: "https://www.youtube.com/watch?v=vid-abc",
          final_url: "https://www.youtube.com/watch?v=vid-abc",
          title: "Demo",
          format: "markdown",
          text: "Some page chrome",
          highlights: [
            { text: "This product is too expensive for indies.", rank: 1 },
          ],
        },
      ],
    });
    agentRun.mockResolvedValue({
      status: "FAILED",
      result: null,
      error: { message: "should not be needed" },
    });

    const { comments, meta } = await fetchYouTubeCommentsWithMeta({
      videoIds: ["vid-abc"],
    });

    expect(meta.provider).toBe("tinyfish_fetch");
    expect(comments[0]?.text).toContain("too expensive");
    expect(agentRun).not.toHaveBeenCalled();
  });

  it("falls back to fixtures when scrape paths fail", async () => {
    process.env.TINYFISH_API_KEY = "sk-tinyfish-test";
    fetchGetContents.mockRejectedValue(new Error("fetch down"));
    agentRun.mockResolvedValue({
      status: "FAILED",
      result: null,
      error: { message: "timeout" },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { comments, meta } = await fetchYouTubeCommentsWithMeta({
      videoIds: ["vid-abc"],
    });
    expect(meta.provider).toBe("fixture");
    expect(comments.length).toBeGreaterThan(0);
  });
});

describe("Product Hunt provider order", () => {
  it("prefers TinyFish search+fetch over agent", async () => {
    process.env.TINYFISH_API_KEY = "sk-tinyfish-test";
    searchQuery.mockResolvedValue({
      results: [
        {
          url: "https://www.producthunt.com/posts/listenlane",
          title: "Listenlane",
          snippet: "Social listening for indie SaaS",
          position: 1,
        },
      ],
    });
    fetchGetContents.mockResolvedValue({
      results: [
        {
          url: "https://www.producthunt.com/posts/listenlane",
          final_url: "https://www.producthunt.com/posts/listenlane",
          title: "Listenlane",
          description: "Social listening for indie SaaS",
          text: "# Listenlane\nSocial listening for indie SaaS",
          highlights: [],
        },
      ],
    });

    const { posts, meta } = await fetchProductHuntPostsWithMeta({ first: 5 });
    expect(meta.provider).toBe("tinyfish_search_fetch");
    expect(posts[0]?.name).toBe("Listenlane");
    expect(agentRun).not.toHaveBeenCalled();
  });
});

describe("collector metadata", () => {
  it("marks youtube scavio documents", async () => {
    process.env.SCAVIO_API_KEY = "sk_test";
    youtubeComments.mockResolvedValue({
      comments: [
        {
          id: "c9",
          author: "bob",
          text: "hello world from youtube",
          video_id: "vid-abc",
        },
      ],
    });

    const result = await youtubeCollector.run({
      workspaceId: "ws-1",
      sourceId: "src-1",
      config: { videoIds: ["vid-abc"] },
    });

    expect(result.documents[0]?.metadata).toMatchObject({
      provider: "scavio",
      mocked: false,
    });
  });

  it("marks producthunt search-fetch documents", async () => {
    process.env.TINYFISH_API_KEY = "sk-tinyfish-test";
    searchQuery.mockResolvedValue({
      results: [
        {
          url: "https://www.producthunt.com/posts/shiplog",
          title: "ShipLog",
          snippet: "Changelog",
          position: 1,
        },
      ],
    });
    fetchGetContents.mockResolvedValue({
      results: [
        {
          url: "https://www.producthunt.com/posts/shiplog",
          title: "ShipLog",
          text: "Changelog that writes itself",
          highlights: [],
        },
      ],
    });

    const result = await productHuntCollector.run({
      workspaceId: "ws-1",
      sourceId: "src-1",
      config: { first: 1 },
    });

    expect(result.documents[0]?.metadata).toMatchObject({
      provider: "tinyfish_search_fetch",
      mocked: false,
    });
  });
});
