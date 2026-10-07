import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cadenceWhere: undefined as unknown,
  plan: "free",
  lastPolled: new Date(),
  touched: [] as unknown[],
  leased: 0,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        const name = (table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")];
        const rows = () => (name === "workspace" ? [{ plan: state.plan }] : name === "source" && fields && "last" in fields ? [{ last: state.lastPolled }] : []);
        return { where: (w: unknown) => { if (name === "source" && fields && "last" in fields) state.cadenceWhere = w; return Object.assign(Promise.resolve(rows()), { limit: async () => rows() }); } };
      },
    }),
    update: () => ({ set: (values: unknown) => ({ where: async () => { state.touched.push(values); } }) }),
  }),
}));
vi.mock("@/lib/cron/lease", () => ({ withWorkspaceScanLease: async () => { state.leased++; return { collectorResults: [], opportunityResults: [] }; } }));
vi.mock("@/lib/collectors/registry", () => ({ collectorsByType: {} }));
vi.mock("@/lib/collectors/run", () => ({ runCollector: vi.fn() }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: async () => null }));
vi.mock("@/lib/opportunities/run", () => ({ buildOpportunities: vi.fn() }));

import { PgDialect } from "drizzle-orm/pg-core";

import { scanWorkspace } from "@/lib/cron/scan";

beforeEach(() => { state.plan = "free"; state.lastPolled = new Date(); state.touched = []; state.leased = 0; });

it("skips many recently-scanned Free workspaces and moves each to the back of the tick rotation", async () => {
  const results = [];
  for (let i = 0; i < 30; i++) results.push(await scanWorkspace(`ws-${i}`, undefined, { enforceCadence: true }));
  expect(results.every((r) => r.opportunityResults[0] && "skipped" in r.opportunityResults[0])).toBe(true);
  expect(state.touched).toHaveLength(30); // every skipped workspace is touched, so rotation advances
  // The tick route orders by updatedAt, so that is the field that must be bumped.
  expect(state.touched.every((v) => (v as { updatedAt?: unknown }).updatedAt instanceof Date)).toBe(true);
  expect(state.leased).toBe(0);
});

it("scans a Pro workspace polled 4 hours ago but not a Free one", async () => {
  state.lastPolled = new Date(Date.now() - 4 * 3_600_000);
  state.plan = "pro";
  await scanWorkspace("ws-pro", undefined, { enforceCadence: true });
  expect(state.leased).toBe(1);
  state.plan = "free";
  await scanWorkspace("ws-free", undefined, { enforceCadence: true });
  expect(state.leased).toBe(1);
});

it("never enforces cadence for manual scans", async () => {
  await scanWorkspace("ws", undefined, {});
  expect(state.leased).toBe(1);
});

it("measures cadence only against sources the scheduled scan can run", async () => {
  await scanWorkspace("ws", undefined, { enforceCadence: true });
  const { sql: text, params } = new PgDialect().sqlToQuery(state.cadenceWhere as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(text).toContain('"lane"');
  expect(text).toContain('"health"');
  expect(text).toContain('"type" in');
  expect(params).toEqual(expect.arrayContaining(["free", "paused", "hn", "rss", "substack"]));
});
