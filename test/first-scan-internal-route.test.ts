import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ exists: true, scopes: [] as unknown[], db: vi.fn(), step: vi.fn() }));
vi.mock("@/lib/activation/run", () => ({ firstScanStep: (...args: unknown[]) => state.step(...args) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => {
  state.db();
  return { select: () => ({ from: () => ({ where: (scope: unknown) => ({ limit: async () => {
    state.scopes.push(scope);
    return state.exists ? [{ id: WS }] : [];
  } }) }) }) };
} }));

import { POST } from "@/app/api/internal/scan/first/route";
const WS = "11111111-1111-4111-8111-111111111111";
const call = (authorization?: string, workspaceId = WS) => POST(new Request("https://test/api/internal/scan/first", {
  method: "POST", headers: authorization ? { authorization } : {}, body: JSON.stringify({ workspaceId, action: "plan" }),
}));

beforeEach(() => {
  state.exists = true; state.scopes = []; state.db.mockReset(); state.step.mockReset();
  state.step.mockResolvedValue(Response.json({ ok: true }));
  vi.stubEnv("CRON_SECRET", "synthetic-service-bearer");
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "Bearer wrong", "Bearer synthetic-service-bearex"])("rejects missing or incorrect bearer %s before any database access or scan work", async (authorization) => {
  expect((await call(authorization)).status).toBe(401);
  expect(state.db).not.toHaveBeenCalled();
  expect(state.step).not.toHaveBeenCalled();
});

it("fails closed without a configured secret, even outside production", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("CRON_SECRET", "");
  expect((await call("Bearer synthetic-service-bearer")).status).toBe(401);
  expect(state.db).not.toHaveBeenCalled();
  expect(state.step).not.toHaveBeenCalled();
});

it("rejects malformed and nonexistent workspace scopes before scan work", async () => {
  expect((await call("Bearer synthetic-service-bearer", "bad")).status).toBe(400);
  expect(state.db).not.toHaveBeenCalled();
  state.exists = false;
  const response = await call("Bearer synthetic-service-bearer");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not found" });
  expect(state.step).not.toHaveBeenCalled();
});

it("accepts the service bearer without a session and checks exactly the requested workspace before dispatch", async () => {
  expect((await call("Bearer synthetic-service-bearer")).status).toBe(200);
  expect(state.step).toHaveBeenCalledWith(WS, { workspaceId: WS, action: "plan" }, expect.any(AbortSignal));
  const query = new PgDialect().sqlToQuery(state.scopes[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(query.sql).toContain('"workspace"."id"');
  expect(query.params).toEqual([WS]);
});
