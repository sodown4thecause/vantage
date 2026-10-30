import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  enrich: vi.fn(),
  attach: vi.fn(),
  semantic: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({
    limit: async () => state.rows,
  }) }) }) }) }),
}));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: async () => ({}) }));
vi.mock("@/lib/enrich/run", () => ({ enrichLinkDocuments: state.enrich, attachLinkedContext: state.attach }));
vi.mock("@/lib/pipeline/shadow", () => ({ runSemanticStageDetailed: state.semantic }));

import { buildOpportunities } from "@/lib/opportunities/run";

beforeEach(() => {
  vi.resetAllMocks();
});

it.each([false, true])("scores fresh linked context even when persistence fails: %s", async fails => {
  const context = { url: "https://example.com/article", kind: "page", title: "Article", summary: "Looking to buy a CRM" };
  state.rows = [{
    id: "doc", workspaceId: "ws", sourceId: "source", title: "News", contentMd: "",
    urlCanonical: context.url, platform: "reddit", authorRef: null, contentHash: "hash",
    postedAt: new Date(), collectedAt: new Date(), metadata: { provider: "scavio", score: 10 },
  }];
  state.enrich.mockResolvedValue(new Map([["doc", context]]));
  if (fails) state.attach.mockRejectedValue(new Error("Persistence unavailable"));
  const stop = new Error("Stop after normalization");
  state.semantic.mockRejectedValue(stop);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(buildOpportunities({ workspaceId: "ws" })).rejects.toBe(stop);
    expect(state.semantic.mock.calls[0][1]).toEqual([
      expect.objectContaining({ text: "News Linked page: Looking to buy a CRM" }),
    ]);
    expect(state.rows[0]).toMatchObject({ metadata: { provider: "scavio", score: 10, linkedContext: context } });
    expect(state.attach).toHaveBeenCalledWith(["doc"], expect.any(Map), "ws");
  } finally {
    error.mockRestore();
  }
});
