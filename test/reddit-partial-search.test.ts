import { expect, it, vi } from "vitest";

vi.mock("@/lib/reddit/client", () => ({ fetchRedditPostsWithMeta: vi.fn() }));
import { fetchRedditPostsWithMeta } from "@/lib/reddit/client";
import { redditCollector } from "@/lib/collectors/reddit";

it("retains genuine earlier search results as partial when a later topic hits the scan allowance", async () => {
  vi.mocked(fetchRedditPostsWithMeta).mockResolvedValueOnce({
    posts: [{ id: "synthetic", title: "Synthetic question", url: "https://www.reddit.com/r/synthetic/comments/abc/", body: "Synthetic fixture only", createdAt: new Date().toISOString(), score: null, numComments: null, contentKind: "preview" }],
    meta: { provider: "firecrawl_search" }, cursor: null,
  }).mockRejectedValueOnce(new Error("First scan allowance exhausted"));
  const result = await redditCollector.run({ workspaceId: "ws", sourceId: "source", config: { queries: ["synthetic alpha", "synthetic beta"], limit: 10 } });
  expect(result.partial).toBe(true);
  expect(result.documents).toHaveLength(1);
  expect(result.documents[0].metadata).toMatchObject({ provider: "firecrawl_search", mocked: false, discoveryOnly: true });
  expect(result.documents[0].title).toBe("Synthetic question");
});
