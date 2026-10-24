import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  profile: true as boolean, profileError: undefined as undefined | Error,
  controller: new AbortController(), receipt: {} as Record<string, unknown>, build: vi.fn(), lease: undefined as undefined | Error,
}));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: async () => ({ ok: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cf/queue", () => ({ enqueueEmbedJob: vi.fn() }));
vi.mock("@/lib/cron/scan", () => ({ scanWorkspace: vi.fn() }));
vi.mock("@/lib/collectors/registry", () => ({ collectorsByType: { rss: { name: "rss" } } }));
vi.mock("@/lib/collectors/run", () => ({ runCollector: async () => state.receipt }));
vi.mock("@/lib/opportunities/run", () => ({ buildOpportunities: (...args: unknown[]) => state.build(...args) }));
vi.mock("@/lib/profile/repository", () => ({ PROFILE_SOURCE_NAME: "Profile: Hacker News", getLatestMonitoringProfile: async () => {
  if (state.profileError) throw state.profileError;
  return state.profile ? { id: "p" } : null;
} }));
vi.mock("@/lib/cron/lease", () => ({ withWorkspaceScanLease: async (_w: string, work: (s: AbortSignal) => Promise<unknown>) => {
  if (state.lease) throw state.lease;
  return work(state.controller.signal);
} }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "s1", type: "rss", health: "healthy" }] }) }) }) }) }));
import { scanSource } from "@/lib/sources/actions";
import { ScanLeaseBusyError } from "@/lib/cron/lease-error";

let logged: unknown[][];
beforeEach(() => {
  state.profile = true; state.lease = undefined;
  state.profileError = undefined; state.controller = new AbortController();
  state.receipt = { sourceId: "s1", collector: "rss", inserted: 3, skipped: 0 };
  state.build = vi.fn(async () => ({}));
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args); });
});

it("reports success when documents were inserted and the queue refreshed", async () => {
  expect(await scanSource("ws", "s1")).toEqual({ message: "Source scanned. The opportunity queue is refreshed." });
});

it("does not report a false failure when the workspace has no monitoring profile", async () => {
  state.profile = false;
  const result = await scanSource("ws", "s1");
  expect(result.error).toBeUndefined();
  expect(result.message).toContain("3 new documents saved");
  expect(state.build).not.toHaveBeenCalled();
});

it("returns a truthful partial result and logs a structured error when the queue build fails after inserting", async () => {
  state.build = vi.fn(async () => { throw new Error("boom https://secret.example/?key=abc"); });
  const result = await scanSource("ws", "s1");
  expect(result.error).toBeUndefined();
  expect(result.message).toContain("3 new documents saved");
  expect(result.message).toContain("could not be refreshed");
  expect(logged[0][0]).toBe("[scan-source] failed");
  expect(logged[0][1]).toMatchObject({ stage: "opportunity-build", workspaceId: "ws", sourceId: "s1", inserted: 3, errorName: "Error" });
});

it("preserves saved documents when the monitoring profile lookup fails", async () => {
  state.profileError = new Error("Profile lookup timed out");
  const result = await scanSource("ws", "s1");
  expect(result.error).toBeUndefined();
  expect(result.message).toContain("3 new documents saved");
  expect(result.message).toContain("could not be refreshed");
  expect(state.build).not.toHaveBeenCalled();
  expect(logged[0][1]).toMatchObject({ stage: "opportunity-build", inserted: 3 });
});

it("preserves saved documents when the deadline expires during the queue build", async () => {
  state.build = vi.fn(async () => {
    state.controller.abort(new DOMException("Scan deadline expired", "TimeoutError"));
    state.controller.signal.throwIfAborted();
  });
  const result = await scanSource("ws", "s1");
  expect(result.error).toBeUndefined();
  expect(result.message).toContain("3 new documents saved");
  expect(result.message).toContain("could not be refreshed");
  expect(logged[0][1]).toMatchObject({ stage: "opportunity-build", inserted: 3, errorName: "TimeoutError" });
});

it("still returns an error when the collector itself failed", async () => {
  state.receipt = { sourceId: "s1", collector: "rss", inserted: 0, skipped: 0, error: "Budget limited" };
  expect(await scanSource("ws", "s1")).toEqual({ error: "Source could not be scanned. Check its coverage status." });
  expect(state.build).not.toHaveBeenCalled();
});

it("logs unexpected exceptions and tells the user when a scan is already running", async () => {
  state.lease = new ScanLeaseBusyError();
  expect(await scanSource("ws", "s1")).toEqual({ error: "A scan is already running for this workspace. Try again in a minute." });
  expect(logged[0][1]).toMatchObject({ stage: "scan", errorName: "ScanLeaseBusyError" });
});
