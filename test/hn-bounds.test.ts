import { afterEach, expect, it, vi } from "vitest";
import { hnCollector } from "@/lib/collectors/hn";
afterEach(() => vi.unstubAllGlobals());
it("stops before requesting more data when the scan deadline expires", async () => {
  const controller = new AbortController();
  controller.abort();
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(hnCollector.run({ workspaceId: "ws", sourceId: "source", config: {}, signal: controller.signal })).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it("honours the pilot page bound and avoids per-item enrichment", async () => {
  const request = vi.fn(async () => Response.json({ hits: [{ objectID: "1", title: "Agent evaluation" }], nbPages: 10 }));
  vi.stubGlobal("fetch", request);
  const result = await hnCollector.run({ workspaceId: "ws", sourceId: "source", config: { queries: ["agents"], maxPages: 1, enrich: false } });
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.documents).toHaveLength(1);
});
it("returns a partial result when only some Algolia requests time out", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ hits: [{ objectID: "1", title: "Agent evaluation" }], nbPages: 1 }))
    .mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  vi.stubGlobal("fetch", request);
  const result = await hnCollector.run({ workspaceId: "ws", sourceId: "source", config: { queries: ["agents", "evals"], maxPages: 1 } });
  expect(result.documents).toHaveLength(1);
  expect(result.partial).toBe(true);
  expect(result.coverageReason).toContain("1 of 2");
  expect(result.nextState).toBeUndefined();
});
it("still fails when every Algolia request times out", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
  await expect(hnCollector.run({ workspaceId: "ws", sourceId: "source", config: { queries: ["agents"], maxPages: 1 } })).rejects.toThrow(/timeout/);
});
