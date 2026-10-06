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
