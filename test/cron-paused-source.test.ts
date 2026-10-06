import { expect, it, vi } from "vitest";

const rows = vi.hoisted(() => [{ id: "s1", type: "hn", workspaceId: "ws-1" }]);
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }),
    }),
  }),
}));
vi.mock("@/lib/collectors/registry", () => ({ collectorsByType: { hn: { name: "hn" } } }));
vi.mock("@/lib/collectors/run", () => ({
  runCollector: async () => ({
    sourceId: "s1",
    collector: "hn",
    inserted: 0,
    skipped: 0,
    switchedOff: { state: "paused", reason: "HN paused" },
  }),
}));
vi.mock("@/lib/cron/lease", () => ({
  withWorkspaceScanLease: async (_id: string, run: (s: AbortSignal) => Promise<unknown>) =>
    run(new AbortController().signal),
}));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: async () => ({ version: 1 }) }));
vi.mock("@/lib/opportunities/run", () => ({ buildOpportunities: async () => ({ scanned: 0 }) }));

import { scanWorkspace } from "@/lib/cron/scan";

it("reports a switched-off source as skipped, never as an error", async () => {
  const result = (await scanWorkspace("ws-1")) as {
    collectorResults: Array<Record<string, unknown>>;
  };
  expect(result.collectorResults).toEqual([
    { workspaceId: "ws-1", sourceId: "s1", type: "hn", skipped: true, reason: "source paused" },
  ]);
  expect(result.collectorResults[0]).not.toHaveProperty("error");
});
