import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ queue: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/opportunities/run", () => ({ listOpportunityQueue: mocks.queue, getOpportunityDetail: mocks.detail }));
import { loadGtmEvidence } from "@/lib/gtm/answer";
beforeEach(() => vi.resetAllMocks());
it("reads only workspace-owned evidence, bounds excerpts, and preserves actual source links", async () => {
  mocks.queue.mockResolvedValue([{ id: "actual" }]);
  mocks.detail.mockResolvedValue({ id: "actual", title: "Buyer conversation", summary: "x".repeat(900), whyItMatters: "Fit", evidence: [{ title: "Source", urlCanonical: "https://example.com/thread", platform: "hn", contentMd: "x".repeat(3000) }] });
  const result = await loadGtmEvidence("owned");
  expect(mocks.queue).toHaveBeenCalledWith({ workspaceId: "owned", limit: 5 });
  expect(mocks.detail).toHaveBeenCalledWith({ workspaceId: "owned", opportunityId: "actual" });
  expect(result.data.evidence[0]!.summary).toHaveLength(600);
  expect(result.data.evidence[0]!.sources[0]).toMatchObject({ url: "https://example.com/thread", excerpt: "x".repeat(800) });
});
it("does not substitute model evidence for empty or unavailable details", async () => {
  mocks.queue.mockResolvedValue([{ id: "missing" }]); mocks.detail.mockResolvedValue(null);
  expect((await loadGtmEvidence("owned")).data).toEqual({ evidence: [], blocks: [] });
  mocks.queue.mockResolvedValue([]); mocks.detail.mockClear();
  expect((await loadGtmEvidence("owned")).data.evidence).toEqual([]);
  expect(mocks.detail).not.toHaveBeenCalled();
});
