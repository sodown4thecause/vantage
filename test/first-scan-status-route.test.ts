import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ auth: { ok: false, status: 401 } as { ok: boolean; status?: number }, retry: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: vi.fn(async () => state.auth) }));
vi.mock("@/lib/activation/dispatch", () => ({ firstScan: vi.fn(), startFirstScan: (...args: unknown[]) => state.retry(...args) }));
vi.mock("@/lib/plans/limits", () => ({ getLimits: async () => ({ scan_interval_hours: 3 }), getWorkspacePlan: async () => "free" }));
vi.mock("@/lib/db/client", () => ({ getDb: () => state.db() }));
import { GET, POST } from "@/app/api/workspace/first-scan/route";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { firstScan } from "@/lib/activation/dispatch";
const WS = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { state.auth = { ok: false, status: 401 }; state.retry.mockReset(); state.db.mockReset(); vi.mocked(authorizeWorkspace).mockClear(); });

it.each([401, 403])("gives signed-out and foreign-workspace users the same 404 (%s), without reads, writes or dispatch", async (status) => {
  state.auth = { ok: false, status };
  const response = await GET(new Request(`https://test/api/workspace/first-scan?workspaceId=${WS}`));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not found" });
  expect((await POST(new Request("https://test/api/workspace/first-scan", { method: "POST", body: JSON.stringify({ workspaceId: WS }) }))).status).toBe(404);
  expect(authorizeWorkspace).toHaveBeenCalledWith(WS);
  expect(state.retry).not.toHaveBeenCalled();
  expect(state.db).not.toHaveBeenCalled();
});

it("validates malformed scope before authorisation and dispatches only the authorised workspace", async () => {
  expect((await GET(new Request("https://test/api/workspace/first-scan?workspaceId=bad"))).status).toBe(404);
  expect(authorizeWorkspace).not.toHaveBeenCalled();
  state.auth = { ok: true };
  state.retry.mockResolvedValue({ status: "queued" });
  expect((await POST(new Request("https://test/api/workspace/first-scan", { method: "POST", body: JSON.stringify({ workspaceId: WS }) }))).status).toBe(202);
  expect(state.retry).toHaveBeenCalledExactlyOnceWith(WS, true);
});

it.each([{ read: 49, sourceIds: ["one", "two"] }, { read: 50, sourceIds: ["one"] }])("bases empty advice on $read documents, not source count", async (run) => {
  state.auth = { ok: true };
  vi.mocked(firstScan).mockResolvedValue({ ...run, status: "done", picked: 0 } as Awaited<ReturnType<typeof firstScan>>);
  state.db.mockReturnValue({
    update: () => ({ set: () => ({ where: async () => [] }) }),
    select: () => ({ from: () => ({ where: () => {
      const rows = [{ timeZone: "UTC", last: null }];
      return Object.assign(Promise.resolve(rows), { limit: async () => rows });
    } }) }),
  });
  const response = await GET(new Request(`https://test/api/workspace/first-scan?workspaceId=${WS}`));
  expect(response.status).toBe(200);
  expect((await response.json()).reason).toContain(run.read < 50 ? "Few sources are configured" : "topics may be too narrow");
});

it("exposes current-run safe health without borrowing older or foreign source receipts", async () => {
  state.auth = { ok: true };
  const startedAt = new Date("2026-10-26T00:00:00Z");
  const finishedAt = new Date("2026-10-26T00:05:00Z");
  vi.mocked(firstScan).mockResolvedValue({ status: "partial", read: 5, sourceIds: ["reddit-1", "reddit-2"], startedAt, finishedAt } as Awaited<ReturnType<typeof firstScan>>);
  const scopes: unknown[] = [];
  const health = { state: "partial", discovered: 1, verified: 0,
    issues: [{ stage: "hydration", kind: "upstream_failed", provider: "tinyfish_search_fetch", retryable: true, message: "private provider detail" }] };
  state.db.mockReturnValue({
    select: () => ({ from: () => ({ where: (scope: unknown) => {
      scopes.push(scope);
      const rows = scopes.length === 1 ? [{ timeZone: "UTC", stale: false, now: finishedAt }]
        : scopes.length === 2 ? [{ last: finishedAt }]
          : [
            { id: "reddit-1", config: { lastRun: { coverage: "degraded", ranAt: "2026-10-26T00:01:00Z", scanHealth: health } } },
            { id: "reddit-2", config: { lastRun: { coverage: "healthy", ranAt: "2026-10-25T00:01:00Z", scanHealth: { ...health, discovered: 99, verified: 99 } } } },
          ];
      return Object.assign(Promise.resolve(rows), { limit: async () => rows });
    } }) }),
  });
  const response = await GET(new Request(`https://test/api/workspace/first-scan?workspaceId=${WS}`));
  const body = await response.json();
  expect(body.scanHealth).toMatchObject({ state: "partial", discovered: 1, verified: 0 });
  expect(body.scanHealth.issues).toContainEqual({ stage: "hydration", kind: "upstream_failed", provider: "tinyfish_search_fetch", retryable: true });
  expect(JSON.stringify(body)).not.toContain("private provider detail");
  const query = new PgDialect().sqlToQuery(scopes[2] as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(query.sql).toContain('"source"."workspace_id" =');
  expect(query.params).toEqual(expect.arrayContaining([WS, "reddit-1", "reddit-2"]));
});
