import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  run: {} as Record<string, unknown>, owned: true, lease: true, released: vi.fn(), collect: vi.fn(), build: vi.fn(), emails: vi.fn(), scopes: [] as string[],
}));
vi.mock("@/lib/activation/dispatch", () => ({ firstScan: async () => ({ ...state.run }) }));
vi.mock("@/lib/analytics/activation", () => ({ captureActivation: vi.fn(async () => {}) }));
vi.mock("@/lib/activation/budget", () => ({ withFirstScanBudget: async (_ws: string, _run: string, work: () => Promise<unknown>) => work() }));
vi.mock("@/lib/cron/lease", () => ({ claimScanLease: async () => state.lease ? state.run.leaseToken : null, releaseScanLease: (...args: unknown[]) => state.released(...args) }));
vi.mock("@/lib/cron/scan", () => ({ eligibleSourceCondition: () => undefined, scanOrder: async () => [] }));
vi.mock("@/lib/cron/steps", () => ({ collectSource: (...args: unknown[]) => state.collect(...args), buildWorkspace: (...args: unknown[]) => state.build(...args) }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: async () => ({ version: 1 }) }));
vi.mock("@/lib/email/activation", () => ({ sendFirstScanEmail: (...args: unknown[]) => state.emails(...args) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => state.owned ? [{ id: "ws" }] : [] }) }) }),
  update: () => ({ set: (value: Record<string, unknown>) => ({ where: (scope: unknown) => {
    const apply = () => {
      state.scopes.push(JSON.stringify(new PgDialect().sqlToQuery(scope as Parameters<PgDialect["sqlToQuery"]>[0])));
      Object.assign(state.run, value, value.capped && typeof value.capped !== "boolean" ? { capped: state.run.capped } : {});
      return [{ ...state.run }];
    };
    return { returning: async () => apply(), then: (ok: (value: unknown) => unknown) => Promise.resolve(apply()).then(ok) };
  } }) }),
}) }));

import { firstScanStep } from "@/lib/activation/run";
const WS = "11111111-1111-4111-8111-111111111111";
const LEASE = "22222222-2222-4222-8222-222222222222";
const call = (action: string, extra: Record<string, unknown> = {}) => firstScanStep(WS, { action, leaseToken: LEASE, ...extra }, new AbortController().signal);
beforeEach(() => {
  state.run = { id: `first-${WS}`, workspaceId: WS, kind: "first", status: "running", leaseToken: LEASE, sourceIds: ["source"], read: 10, relevant: 0, picked: 0, capped: false, costUsd: "0.04" };
  state.owned = true; state.lease = true; state.scopes = []; state.released.mockReset(); state.emails.mockReset(); state.emails.mockResolvedValue(undefined);
  state.collect.mockReset(); state.build.mockReset();
});

it("a capped scan preserves real results, honest counters, cost and a partial terminal state", async () => {
  state.run.capped = true;
  state.build.mockResolvedValue({ scanned: 10, relevant: 3, top: [{ id: "real-1" }, { id: "real-2" }] });
  expect((await call("build")).status).toBe(200);
  expect(state.run).toMatchObject({ read: 10, relevant: 3, picked: 2, capped: true, costUsd: "0.04" });
  expect(await (await call("finish")).json()).toEqual({ status: "partial" });
  expect(state.emails).toHaveBeenCalledWith(WS, 2, 10);
  expect(state.released).toHaveBeenCalledWith(WS, LEASE);
  expect(state.scopes.every((scope) => scope.includes(WS) && scope.includes(LEASE))).toBe(true);
  expect(await (await call("finish")).json()).toEqual({ status: "partial" });
  expect(state.emails).toHaveBeenCalledTimes(1);
});

it("distinguishes zero results from failure without creating picks", async () => {
  state.build.mockResolvedValue({ scanned: 0, relevant: 0, top: [] });
  await call("build");
  expect(await (await call("finish")).json()).toEqual({ status: "done" });
  expect(state.run.picked).toBe(0);
  expect(state.emails).toHaveBeenCalledWith(WS, 0, 10);
  state.run.status = "running";
  expect(await (await call("finish", { failed: true })).json()).toEqual({ status: "failed" });
  expect(state.emails).toHaveBeenCalledTimes(1);
});

it("does not overlap an existing lease, collect a foreign source or let a stale holder write progress", async () => {
  state.lease = false;
  expect((await call("plan")).status).toBe(409);
  expect(state.collect).not.toHaveBeenCalled();
  expect((await call("collect", { sourceId: "foreign" })).status).toBe(404);
  expect((await call("read", { leaseToken: "old-token", read: 999 })).status).toBe(409);
  state.owned = false;
  expect((await call("build")).status).toBe(409);
  expect(state.build).not.toHaveBeenCalled();
  expect(state.scopes).toEqual([]);
});
