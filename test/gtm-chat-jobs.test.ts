import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ row: { id: "first-test", kind: "first", status: "cancel_requested", leaseToken: "token", sourceIds: ["source"] } as Record<string, unknown>, collect: vi.fn(), build: vi.fn(), email: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/activation/dispatch", () => ({ firstScan: async () => ({ ...state.row }) }));
vi.mock("@/lib/analytics/activation", () => ({ captureActivation: vi.fn() }));
vi.mock("@/lib/activation/budget", () => ({ withFirstScanBudget: async (_w: string, _r: string, work: () => Promise<unknown>) => work() }));
vi.mock("@/lib/cron/lease", () => ({ claimScanLease: vi.fn(), releaseScanLease: state.release }));
vi.mock("@/lib/cron/steps", () => ({ collectSource: state.collect, buildWorkspace: state.build }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: vi.fn() }));
vi.mock("@/lib/email/activation", () => ({ sendFirstScanEmail: state.email }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "workspace" }] }) }) }),
  update: () => ({ set: (values: object) => ({ where: () => ({ returning: async () => { Object.assign(state.row, values); return [{ ...state.row }]; }, then: (resolve: (value: unknown) => void) => { Object.assign(state.row, values); resolve([]); } }) }) }),
}) }));
import { firstScanStep } from "@/lib/activation/run";
beforeEach(() => { vi.clearAllMocks(); state.row.status = "cancel_requested"; state.collect.mockResolvedValue({ kind: "ok", body: { inserted: 0 } }); state.build.mockResolvedValue({ scanned: 0, top: [] }); });
it("acknowledges persisted cancellation only in finish, without upstream work or completion email", async () => {
  for (const action of ["collect", "build", "read"]) {
    const response = await firstScanStep("workspace", { action, leaseToken: "token", sourceId: "source" }, new AbortController().signal);
    expect(await response.json()).toMatchObject({ cancelled: true });
    expect(state.row.status).toBe("cancel_requested");
  }
  expect(state.collect).not.toHaveBeenCalled(); expect(state.build).not.toHaveBeenCalled();
  const response = await firstScanStep("workspace", { action: "finish", leaseToken: "token" }, new AbortController().signal);
  expect(await response.json()).toEqual({ status: "cancelled" });
  expect(state.email).not.toHaveBeenCalled(); expect(state.release).toHaveBeenCalledWith("workspace", "token");
});
