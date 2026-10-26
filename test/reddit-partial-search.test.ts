import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/reddit/client", () => ({ fetchRedditPostsWithMeta: vi.fn() }));
import { fetchRedditPostsWithMeta } from "@/lib/reddit/client";
import { redditCollector } from "@/lib/collectors/reddit";

beforeEach(() => { vi.resetAllMocks(); });

it.each(["unprocessed-cursor", undefined])("retains genuine results and preserves cursor %j when a later topic hits the scan allowance", async (cursor) => {
  vi.mocked(fetchRedditPostsWithMeta).mockResolvedValueOnce({
    posts: [{ id: "synthetic", title: "Synthetic question", url: "https://www.reddit.com/r/synthetic/comments/abc/", body: "Synthetic fixture only", createdAt: new Date().toISOString(), score: null, numComments: null, contentKind: "preview" }],
    meta: { provider: "firecrawl_search" }, cursor: null,
  }).mockRejectedValueOnce(new Error("First scan allowance exhausted"));
  const result = await redditCollector.run({ workspaceId: "ws", sourceId: "source", cursor, config: { queries: ["synthetic alpha", "synthetic beta"], limit: 10 } });
  expect(result.partial).toBe(true);
  expect(result.documents).toHaveLength(1);
  expect(result.documents[0].metadata).toMatchObject({ provider: "firecrawl_search", mocked: false, discoveryOnly: true });
  expect(result.documents[0].title).toBe("Synthetic question");
  expect(result.nextState?.cursor).toBe(cursor);
});

it("propagates the first topic's failure instead of reporting an empty completed scan", async () => {
  const error = new Error("First scan allowance exhausted");
  vi.mocked(fetchRedditPostsWithMeta).mockRejectedValueOnce(error);
  await expect(redditCollector.run({ workspaceId: "ws", sourceId: "source", cursor: "unprocessed-cursor",
    config: { queries: ["synthetic alpha", "synthetic beta"] } })).rejects.toBe(error);
});

it("reports a completed empty search without fabricating conversations", async () => {
  vi.mocked(fetchRedditPostsWithMeta).mockResolvedValue({ posts: [], meta: { provider: "firecrawl_search" }, cursor: null });
  const result = await redditCollector.run({ workspaceId: "ws", sourceId: "source", config: { queries: ["synthetic alpha", "synthetic beta"] } });
  expect(result.documents).toEqual([]);
  expect(result.partial).toBe(false);
  expect(result.nextState?.cursor).toBeNull();
});

it("propagates cancellation after genuine results instead of treating it as a deferred topic", async () => {
  const controller = new AbortController();
  vi.mocked(fetchRedditPostsWithMeta).mockResolvedValueOnce({ posts: [{ id: "synthetic", title: "Synthetic question",
    url: "https://www.reddit.com/r/synthetic/comments/abc/", body: "Synthetic fixture only", createdAt: "2026-10-25T00:00:00Z",
    score: null, numComments: null, contentKind: "preview" }], meta: { provider: "firecrawl_search" }, cursor: null,
  }).mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason; });
  await expect(redditCollector.run({ workspaceId: "ws", sourceId: "source", signal: controller.signal,
    config: { queries: ["synthetic alpha", "synthetic beta"] } })).rejects.toMatchObject({ name: "AbortError" });
});
