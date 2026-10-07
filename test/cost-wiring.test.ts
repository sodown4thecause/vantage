import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CostInput } from "@/lib/costs/ledger";

const mocks = vi.hoisted(() => ({
  recorded: [] as CostInput[],
  execute: vi.fn(),
  agentRun: vi.fn(),
  searchQuery: vi.fn(),
  getContents: vi.fn(),
  redditSearch: vi.fn(),
  xSearch: vi.fn(),
  youtubeComments: vi.fn(),
}));

vi.mock("@/lib/costs/ledger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/costs/ledger")>(),
  recordCost: async (input: CostInput) => {
    mocks.recorded.push(input);
    return true;
  },
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    execute: mocks.execute,
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
import { computeCost } from "@/lib/costs/ledger";
import { redditCollector } from "@/lib/collectors/reddit";
import { runTinyFishStructuredAgent } from "@/lib/tinyfish/agent";
import { tinyFishFetchMarkdown, tinyFishSearch } from "@/lib/tinyfish/search-fetch";
import { fetchRedditPostsWithMeta } from "@/lib/reddit/client";
import { fetchXPostsWithMeta } from "@/lib/x/client";
import { fetchYouTubeCommentsWithMeta } from "@/lib/youtube/client";
import { fetchProductHuntPostsWithMeta } from "@/lib/producthunt/client";

const ORIGINAL_ENV = { ...process.env };
const ctx = { workspaceId: "ws-1", sourceKey: "src-key" };
const redditRow = { id: "abc", title: "Tooling question", body: "Literal public thread",
  url: "https://www.reddit.com/r/LocalLLaMA/comments/abc/tooling/" };

beforeEach(() => {
  mocks.recorded = [];
  for (const m of [mocks.execute, mocks.agentRun, mocks.searchQuery, mocks.getContents, mocks.redditSearch, mocks.xSearch, mocks.youtubeComments]) m.mockReset();
  mocks.execute.mockResolvedValue([{ day: "2026-10-07" }]);
  clearPriceCache();
  process.env = { ...ORIGINAL_ENV };
  process.env.TINYFISH_API_KEY = "test-key";
  process.env.SCAVIO_API_KEY = "test-key";
  process.env.VANTAGE_PAID_PROVIDERS_ENABLED = "true";
  process.env.VANTAGE_PAID_DAILY_BUDGET_USD = "1";
  process.env.VANTAGE_DEMO_FIXTURES = "";
  process.env.X_GATEWAY_EXPERIMENT_ENABLED = "";
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.PH_DEV_TOKEN;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("TinyFish agent FAILED response is recorded ok=false at the call site and still throws", async () => {
    mocks.agentRun.mockResolvedValue({ status: "FAILED", error: { message: "blocked" }, num_of_steps: 3 });
    await expect(
      runTinyFishStructuredAgent({ url: "https://example.com", goal: "g", outputSchema: {}, ctx }),
    ).rejects.toThrow("blocked");
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
    delete process.env.TINYFISH_API_KEY;
    mocks.redditSearch.mockResolvedValue({ results: [redditRow] });
    const out = await fetchRedditPostsWithMeta({ ctx });
    expect(out.meta.provider).toBe("scavio");
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ provider: "scavio", action: "reddit_search", units: 1,
      unitCostUsd: 0.004, sourceKey: "src-key", workspaceId: "ws-1", ok: true });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.invocationCallOrder[0]).toBeLessThan(mocks.redditSearch.mock.invocationCallOrder[0]);
  });

  it("Reddit collector attributes the call to the workspace and source", async () => {
    delete process.env.TINYFISH_API_KEY;
    mocks.redditSearch.mockResolvedValue({ results: [redditRow] });
    await redditCollector.run({ workspaceId: "ws-9", sourceId: "s-1", config: {} });
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ sourceKey: "reddit", workspaceId: "ws-9" });
  });

  it("Reddit provider failure stays charged and cannot silently become fixtures", async () => {
    delete process.env.TINYFISH_API_KEY;
    process.env.VANTAGE_DEMO_FIXTURES = "true";
    mocks.redditSearch.mockRejectedValue(new Error("sk-live-secret"));
    await expect(fetchRedditPostsWithMeta({ ctx })).rejects.toThrow("Reddit provider unavailable");
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ provider: "scavio", action: "reddit_search", unitCostUsd: 0.004,
      sourceKey: "src-key", workspaceId: "ws-1", ok: false, chargedOnFailure: true });
    expect(computeCost(mocks.recorded[0]).costUsd).toBe("0.004000");
    expect(mocks.redditSearch).toHaveBeenCalledOnce();
  });

  it("Reddit records free discovery then exactly one reserved paid Agent attempt", async () => {
    mocks.searchQuery.mockRejectedValue(new Error("Free discovery unavailable"));
    mocks.agentRun.mockResolvedValue({ status: "COMPLETED", result: { posts: [redditRow] }, num_of_steps: 3 });
    const out = await fetchRedditPostsWithMeta({ ctx });
    expect(out.meta.provider).toBe("tinyfish_agent");
    expect(mocks.recorded).toHaveLength(2);
    expect(mocks.recorded[0]).toMatchObject({ provider: "tinyfish", action: "search", unitCostUsd: 0,
      sourceKey: "src-key", workspaceId: "ws-1", ok: false });
    expect(mocks.recorded[1]).toMatchObject({ provider: "tinyfish", action: "agent_step", units: 1,
      unitCostUsd: 0.048, sourceKey: "src-key", workspaceId: "ws-1", ok: true });
    expect(mocks.execute.mock.invocationCallOrder[0]).toBeLessThan(mocks.agentRun.mock.invocationCallOrder[0]);
    expect(mocks.agentRun).toHaveBeenCalledOnce();
    expect(mocks.redditSearch).not.toHaveBeenCalled();
  });

  it("explicit nonproduction demo fixtures require no provider call or ledger event", async () => {
    delete process.env.TINYFISH_API_KEY;
    delete process.env.SCAVIO_API_KEY;
    vi.stubEnv("NODE_ENV", "test");
    process.env.VANTAGE_DEMO_FIXTURES = "true";
    expect((await fetchRedditPostsWithMeta({ ctx })).meta.provider).toBe("fixture");
    expect(mocks.recorded).toHaveLength(0);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.redditSearch).not.toHaveBeenCalled();
  });

  it("X via Scavio records one event", async () => {
    mocks.xSearch.mockResolvedValue({ results: [{ id: "1234567890123456789", text: "Literal X post",
      url: "https://x.com/builder/status/1234567890123456789", created_at: "2026-10-06T12:00:00.000Z" }] });
    await fetchXPostsWithMeta({ ctx });
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.recorded[0]).toMatchObject({ provider: "scavio", action: "x_search", units: 1,
      unitCostUsd: 0.004, sourceKey: "src-key", workspaceId: "ws-1", ok: true });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.invocationCallOrder[0]).toBeLessThan(mocks.xSearch.mock.invocationCallOrder[0]);
  });

  it("budget reservation denial stops X before outbound work and billing", async () => {
    mocks.execute.mockResolvedValue([]);
    await expect(fetchXPostsWithMeta({ ctx })).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(mocks.xSearch).not.toHaveBeenCalled();
    expect(mocks.recorded).toHaveLength(0);
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
