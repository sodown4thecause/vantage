import { afterEach, expect, it, vi } from "vitest";
import { hnCollector } from "@/lib/collectors/hn";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
  vi.spyOn(Date, "now").mockReturnValue(1_790_000_000_000);
  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ hits: [{ objectID: "1", title: "Agent evaluation" }], nbPages: 1 }))
    .mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  vi.stubGlobal("fetch", request);
  const result = await hnCollector.run({ workspaceId: "ws", sourceId: "source", config: { queries: ["agents", "evals"], maxPages: 1 } });
  expect(result.documents).toHaveLength(1);
  expect(result.partial).toBe(true);
  expect(result.coverageReason).toContain("1 of 2");
  expect(result.nextState).toEqual({ cursor: String(since) });
  expect(result.coverageReason).not.toContain("The operation was aborted due to timeout");
  const retryRequest = vi.fn<(url: URL) => Promise<Response>>(async () => Response.json({ hits: [], nbPages: 1 }));
  vi.stubGlobal("fetch", retryRequest);
  vi.spyOn(Date, "now").mockReturnValue(1_790_003_600_000);
  await hnCollector.run({ workspaceId: "ws", sourceId: "source", cursor: result.nextState?.cursor, config: {} });
  expect(new URL(String(retryRequest.mock.calls[0][0])).searchParams.get("numericFilters"))
    .toContain(`created_at_i>${result.nextState?.cursor},`);
});
it("preserves an existing cursor on partial runs", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ hits: [], nbPages: 1 }))
    .mockRejectedValueOnce(new Error("Internal provider error")));
  const result = await hnCollector.run({ workspaceId: "ws", sourceId: "source", cursor: "12345", config: { queries: ["agents", "evals"] } });
  expect(result.nextState).toEqual({ cursor: "12345" });
  expect(result.coverageReason).not.toContain("Internal provider error");
});
it("still fails when every Algolia request times out", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
  await expect(hnCollector.run({ workspaceId: "ws", sourceId: "source", config: { queries: ["agents"], maxPages: 1 } })).rejects.toThrow(/timeout/);
});
