import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recorded: [] as Array<Record<string, unknown>>,
  agentRun: vi.fn(),
  searchQuery: vi.fn(),
  getContents: vi.fn(),
  redditSearch: vi.fn(),
  xSearch: vi.fn(),
  youtubeComments: vi.fn(),
}));

vi.mock("@/lib/costs/ledger", () => ({
  recordCost: async (input: Record<string, unknown>) => {
    mocks.recorded.push(input);
    return true;
  },
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }),
    }),
  }),
}));
vi.mock("@tiny-fish/sdk", () => {
  class TinyFish {
    agent = { run: mocks.agentRun };
    search = { query: mocks.searchQuery };
    fetch = { getContents: mocks.getContents };
  }
  return { TinyFish };
});
vi.mock("scavio", () => {
  class Scavio {
    reddit = { search: mocks.redditSearch };
    x = { search: mocks.xSearch };
    youtube = { comments: mocks.youtubeComments };
  }
  return { Scavio };
});

import { clearPriceCache } from "@/lib/costs/prices";
import { redditCollector } from "@/lib/collectors/reddit";
import { runTinyFishStructuredAgent } from "@/lib/tinyfish/agent";
import { tinyFishFetchMarkdown, tinyFishSearch } from "@/lib/tinyfish/search-fetch";
import { fetchRedditPostsWithMeta } from "@/lib/reddit/client";
import { fetchXPostsWithMeta } from "@/lib/x/client";
import { fetchYouTubeCommentsWithMeta } from "@/lib/youtube/client";
import { fetchProductHuntPostsWithMeta } from "@/lib/producthunt/client";

const ORIGINAL_ENV = { ...process.env };
const ctx = { workspaceId: "ws-1", sourceKey: "src-key" };

beforeEach(() => {
  mocks.recorded = [];
  for (const m of [mocks.agentRun, mocks.searchQuery, mocks.getContents, mocks.redditSearch, mocks.xSearch, mocks.youtubeComments]) m.mockReset();
  clearPriceCache();
  process.env = { ...ORIGINAL_ENV };
  process.env.TINYFISH_API_KEY = "test-key";
  process.env.SCAVIO_API_KEY = "test-key";
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.PH_DEV_TOKEN;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("cost wiring: one cost_event per provider call", () => {
  it("TinyFish agent records steps at the per-step price", async () => {
    mocks.agentRun.mockResolvedValue({ status: "COMPLETED", result: { a: 1 }, num_of_steps: 7 });
    await runTinyFishStructuredAgent({ url: "https://example.com", goal: "g", outputSchema: {}, ctx });
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ provider: "tinyfish", action: "agent_step", units: 7, unitCostUsd: 0.016, sourceKey: "src-key", workspaceId: "ws-1", ok: true });
  });

  it("TinyFish agent failure is recorded as not ok and the error still propagates", async () => {
    mocks.agentRun.mockRejectedValue(new Error("boom"));
    await expect(
      runTinyFishStructuredAgent({ url: "https://example.com", goal: "g", outputSchema: {}, ctx }),
    ).rejects.toThrow("boom");
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ action: "agent_step", ok: false });
  });

  it("TinyFish search records one zero-cost call", async () => {
    mocks.searchQuery.mockResolvedValue({ results: [] });
    await tinyFishSearch("q", { ctx });
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ provider: "tinyfish", action: "search", unitCostUsd: 0, sourceKey: "src-key" });
  });

  it("TinyFish fetch records one event per batch request", async () => {
    mocks.getContents.mockResolvedValue({ results: [] });
    await tinyFishFetchMarkdown(Array.from({ length: 12 }, (_, i) => `https://example.com/${i}`), { ctx });
    expect(mocks.recorded.map((r) => r.action)).toEqual(["fetch", "fetch"]);
  });

  it("Reddit via Scavio records one event at the Scavio price", async () => {
    mocks.redditSearch.mockResolvedValue({ results: [{ id: "a", title: "t" }] });
    const out = await fetchRedditPostsWithMeta({ ctx });
    expect(out.meta.provider).toBe("scavio");
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ provider: "scavio", action: "reddit_search", unitCostUsd: 0.004, sourceKey: "src-key" });
  });

  it("Reddit collector attributes the call to the workspace and source", async () => {
    mocks.redditSearch.mockResolvedValue({ results: [{ id: "a", title: "t" }] });
    await redditCollector.run({ workspaceId: "ws-9", sourceId: "s-1", config: {} });
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ sourceKey: "reddit", workspaceId: "ws-9" });
  });

  it("Reddit provider failure is recorded and the fixture fallback still works", async () => {
    mocks.redditSearch.mockRejectedValue(new Error("down"));
    const out = await fetchRedditPostsWithMeta({ ctx });
    expect(out.meta.provider).toBe("fixture");
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ ok: false });
  });

  it("X via Scavio records one event", async () => {
    mocks.xSearch.mockResolvedValue({ results: [{ id: "1", text: "hello" }] });
    await fetchXPostsWithMeta({ ctx });
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ provider: "scavio", action: "x_search", sourceKey: "src-key" });
  });

  it("YouTube via Scavio records one event per video", async () => {
    mocks.youtubeComments.mockResolvedValue({ comments: [{ id: "c", text: "nice video", author: "a" }] });
    await fetchYouTubeCommentsWithMeta({ videoIds: ["v1", "v2"], ctx });
    expect(mocks.recorded.map((r) => r.action)).toEqual(["youtube_comments", "youtube_comments"]);
    expect(mocks.recorded[0]).toMatchObject({ sourceKey: "src-key" });
  });

  it("Product Hunt TinyFish path records search and fetch events under the source key", async () => {
    mocks.searchQuery.mockResolvedValue({
      results: [{ url: "https://www.producthunt.com/posts/foo", title: "Foo", snippet: "s", position: 1 }],
    });
    mocks.getContents.mockResolvedValue({ results: [] });
    await fetchProductHuntPostsWithMeta({ ctx });
    const actions = mocks.recorded.map((r) => r.action);
    expect(actions).toContain("search");
    expect(actions).toContain("fetch");
    expect(mocks.recorded.every((r) => r.sourceKey === "src-key")).toBe(true);
  });
});
