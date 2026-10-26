import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), instances: new Set<string>(), restarts: 0, unavailable: false, writes: [] as unknown[] }));
vi.mock("@/lib/analytics/activation", () => ({ captureActivation: vi.fn(async () => {}) }));
vi.mock("@/lib/cf/env", () => ({ readBinding: async () => state.unavailable ? undefined : {
  create: async ({ id }: { id: string }) => { if (state.instances.has(id)) throw new Error("instance already exists"); state.instances.add(id); },
  get: async () => ({ status: async () => ({ status: "complete" }), restart: async () => { state.restarts++; } }),
} }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: async () => {
    const id = value.id as string;
    if (!state.rows.has(id)) state.rows.set(id, { status: "queued", reservedUsd: "0.04", ...value });
  } }) }),
  select: () => ({ from: () => ({ where: (condition: unknown) => ({ limit: async () => {
    const params = new PgDialect().sqlToQuery(condition as Parameters<PgDialect["sqlToQuery"]>[0]).params;
    return [...state.rows.values()].filter((row) => params.includes(row.workspaceId) && params.includes(row.id));
  } }) }) }),
  update: () => ({ set: (values: Record<string, unknown>) => ({ where: (condition: unknown) => {
    const apply = () => {
      const query = new PgDialect().sqlToQuery(condition as Parameters<PgDialect["sqlToQuery"]>[0]);
      state.writes.push(query);
      const rows = [...state.rows.values()].filter((row) => query.params.includes(row.workspaceId) && query.params.includes(row.id)
        && (!query.params.includes("failed") || row.status === "failed") && (!query.params.includes("queued") || row.status === "queued"));
      rows.forEach((row) => Object.assign(row, values));
      return rows;
    };
    return { returning: async () => apply(), then: (ok: (value: unknown) => unknown) => Promise.resolve(apply()).then(ok) };
  } }) }),
}) }));

import { firstScan, firstScanId, startFirstScan } from "@/lib/activation/dispatch";
const WS = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { state.rows.clear(); state.instances.clear(); state.restarts = 0; state.unavailable = false; state.writes = []; });

describe("durable first scan dispatch", () => {
  it("concurrent and repeated confirms create one row and one fixed Workflow instance", async () => {
    await Promise.all([startFirstScan(WS), startFirstScan(WS)]);
    await startFirstScan(WS);
    expect([...state.instances]).toEqual([`first-${WS}`]);
    expect(state.rows.size).toBe(1);
    state.rows.get(firstScanId(WS))!.status = "done";
    expect(await startFirstScan(WS)).toEqual({ status: "done" });
    expect(state.restarts).toBe(0);
    expect(await firstScan("22222222-2222-4222-8222-222222222222")).toBeNull();
  });

  it("reports missing durability rather than pretending a scan started", async () => {
    state.unavailable = true;
    expect(await startFirstScan(WS)).toEqual({ status: "failed" });
    expect((await firstScan(WS))?.status).toBe("failed");
    expect(state.instances.size).toBe(0);
  });

  it("only an explicit retry restarts a failed instance and does not replenish its spend", async () => {
    await startFirstScan(WS);
    const row = state.rows.get(firstScanId(WS))!;
    row.status = "failed";
    const oldLease = row.leaseToken;
    await startFirstScan(WS);
    expect(state.restarts).toBe(0);
    await Promise.all([startFirstScan(WS, true), startFirstScan(WS, true)]);
    expect(state.restarts).toBe(1);
    expect(row.leaseToken).not.toBe(oldLease);
    expect(row.reservedUsd).toBe("0.04");
    expect(state.writes.every((q) => JSON.stringify(q).includes(WS))).toBe(true);
  });
});
