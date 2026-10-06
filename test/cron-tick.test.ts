import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ order: [] as string[], fail: false }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: () => ({
  from: (table: { id: unknown }) => {
    const rows = table === workspace ? [{ id: "ws-1" }] : [];
    return Object.assign(Promise.resolve(rows), { where: () => Object.assign(Promise.resolve(rows), { orderBy: () => ({ limit: async () => rows }), limit: async () => rows }) });
  },
}) }) }));
vi.mock("@/lib/collectors/registry", () => ({ collectorsByType: {} }));
vi.mock("@/lib/collectors/run", () => ({ runCollector: vi.fn() }));
vi.mock("@/lib/cron/lease", () => ({ withWorkspaceScanLease: async (_id: string, run: (signal: AbortSignal) => Promise<unknown>) => run(new AbortController().signal) }));
vi.mock("@/lib/pipeline/run", () => ({ runPipeline: async () => { state.order.push("legacy"); return {}; } }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: async () => ({ version: 1 }) }));
vi.mock("@/lib/opportunities/run", () => ({ buildOpportunities: async ({ workspaceId }: { workspaceId: string }) => {
  state.order.push(`opportunities:${workspaceId}`);
  if (state.fail) throw new Error("database failed");
  return { scanned: 2, clusters: 1, upserted: 1, top: [] };
} }));
import { workspace } from "@/lib/db/schema";
import { GET } from "@/app/api/cron/tick/route";

beforeEach(() => { state.order = []; state.fail = false; vi.stubEnv("CRON_SECRET", "secret"); });
it("refreshes the current opportunity queue on a scheduled tick", async () => {
  const response = await GET(new Request("https://example.com/api/cron/tick", { headers: { authorization: "Bearer secret" } }));
  const body = await response.json();
  expect(body.opportunityResults).toEqual([{ workspaceId: "ws-1", scanned: 2, clusters: 1, upserted: 1, top: [] }]);
  expect(state.order).toEqual(["opportunities:ws-1"]);
});
it("returns partial failure when opportunity generation fails", async () => {
  state.fail = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await GET(new Request("https://example.com/api/cron/tick", { headers: { authorization: "Bearer secret" } }));
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(body.opportunityResults).toEqual([{ workspaceId: "ws-1", error: "opportunity build failed" }]);
});
