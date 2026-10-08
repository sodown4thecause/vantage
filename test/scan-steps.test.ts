import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

type Op = { name: string; args: unknown[] };

const state = vi.hoisted(() => ({
  lastPolled: null as Date | null,
  profile: true,
  leaseHeld: false,
  eligible: [] as Array<{ id: string }>,
  sourceRow: null as Record<string, unknown> | null,
  dueWorkspaces: [] as Array<{ id: string }>,
  limits: [] as unknown[],
  writes: [] as Array<{ table: string; set: Record<string, unknown>; where: unknown }>,
  dueWhere: undefined as unknown,
  hashes: new Set<string>(),
  collectorRun: vi.fn(),
  embed: vi.fn(),
  build: vi.fn(),
  rollup: vi.fn(),
}));

// Minimal thenable query builder: records chained calls, resolves them against `state`.
vi.mock("@/lib/db/client", () => {
  const query = (resolve: (ops: Op[]) => unknown, ops: Op[]) => {
    const builder: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          return (ok: (value: unknown) => unknown, bad: (err: unknown) => unknown) =>
            Promise.resolve().then(() => resolve(ops)).then(ok, bad);
        }
        return (...args: unknown[]) => {
          ops.push({ name: String(prop), args });
          return builder;
        };
      },
    });
    return builder;
  };
  return {
    getDb: () => ({
      select: (...args: unknown[]) => query(readRows, [{ name: "select", args }]),
      update: (...args: unknown[]) => query(writeRows, [{ name: "update", args }]),
      insert: (...args: unknown[]) => query(insertRows, [{ name: "insert", args }]),
    }),
  };
});

// Resolvers are referenced only at query time, after the test module has initialised.
function find(ops: Op[], name: string) {
  return ops.find((op) => op.name === name);
}
function readRows(ops: Op[]) {
  const from = find(ops, "from")?.args[0];
  const selected = find(ops, "select")?.args[0] as Record<string, unknown> | undefined;
  const limit = find(ops, "limit");
  if (limit) state.limits.push(limit.args[0]);
  if (selected && "last" in selected) return [{ last: state.lastPolled }];
  if (from === source) return find(ops, "orderBy") ? state.eligible : state.sourceRow ? [state.sourceRow] : [];
  if (from === workspace) {
    state.dueWhere = find(ops, "where")?.args[0];
    return state.dueWorkspaces;
  }
  return [];
}
function writeRows(ops: Op[]) {
  const table = find(ops, "update")?.args[0] === workspace ? "workspace" : "source";
  state.writes.push({ table, set: find(ops, "set")?.args[0] as Record<string, unknown>, where: find(ops, "where")?.args[0] });
  if (find(ops, "returning")) return state.leaseHeld ? [] : [{ id: WS }];
  return undefined;
}
function insertRows(ops: Op[]) {
  const values = find(ops, "values")?.args[0] as Array<{ contentHash: string }>;
  const fresh = values.filter((doc) => !state.hashes.has(doc.contentHash));
  for (const doc of fresh) state.hashes.add(doc.contentHash);
  return fresh.map((_doc, index) => ({ id: `doc-${state.hashes.size}-${index}` }));
}

vi.mock("@/lib/plans/limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plans/limits")>()),
  getWorkspacePlan: async () => "free",
  getLimits: async () => ({ scan_interval_hours: 24 }),
}));
vi.mock("@/lib/profile/repository", () => ({
  getLatestMonitoringProfile: async () => (state.profile ? { version: 1 } : null),
}));
vi.mock("@/lib/collectors/registry", () => ({
  collectorsByType: { hn: { name: "hn", run: (input: unknown) => state.collectorRun(input) } },
}));
vi.mock("@/lib/sources/switch", () => ({
  getSourceSwitch: async () => ({ enabled: true, state: "on", reason: "" }),
}));
vi.mock("@/lib/embeddings/index-documents", () => ({
  embedPendingDocuments: (...args: unknown[]) => state.embed(...args),
}));
vi.mock("@/lib/opportunities/run", () => ({
  buildOpportunities: (...args: unknown[]) => state.build(...args),
}));
vi.mock("@/lib/costs/rollup", () => ({
  rollupRecent: (...args: unknown[]) => state.rollup(...args),
}));

import { workspace, source } from "@/lib/db/schema";
import { POST as dueRoute } from "@/app/api/internal/scan/due/route";
import { POST as planRoute } from "@/app/api/internal/scan/plan/route";
import { POST as collectRoute } from "@/app/api/internal/scan/collect/route";
import { POST as embedRoute } from "@/app/api/internal/scan/embed/route";
import { POST as buildRoute } from "@/app/api/internal/scan/build/route";
import { POST as finishRoute } from "@/app/api/internal/scan/finish/route";
import { POST as rollupRoute } from "@/app/api/internal/scan/rollup/route";

const WS = "11111111-1111-4111-8111-111111111111";
const SRC = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";
const AUTH = { authorization: "Bearer secret" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toSql = (chunk: unknown) => new PgDialect().sqlToQuery(chunk as Parameters<PgDialect["sqlToQuery"]>[0]);

function call(handler: (req: Request) => Promise<Response>, body?: unknown, headers: Record<string, string> = AUTH) {
  const init: RequestInit = { method: "POST", headers: { ...headers, "content-type": "application/json" } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return handler(new Request("https://example.com/api/internal/scan/step", init));
}

const doc = (hash: string) => ({ contentHash: hash, title: `doc ${hash}`, url: `https://example.com/${hash}`, body: "text", platform: "hn" });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.lastPolled = null;
  state.profile = true;
  state.leaseHeld = false;
  state.eligible = [];
  state.sourceRow = { id: SRC, workspaceId: WS, type: "hn", lane: "free", health: "healthy", config: {}, etag: null, lastModified: null, cursor: null };
  state.dueWorkspaces = [{ id: WS }];
  state.limits = [];
  state.writes = [];
  state.hashes = new Set();
  state.collectorRun = vi.fn(async () => ({ documents: [doc("h1"), doc("h2")] }));
  state.embed = vi.fn(async () => ({ embedded: 3 }));
  state.build = vi.fn(async () => ({ scanned: 2, clusters: 1, upserted: 1, top: [] }));
  state.rollup = vi.fn(async () => undefined);
});

const routes = { due: dueRoute, plan: planRoute, collect: collectRoute, embed: embedRoute, build: buildRoute, finish: finishRoute, rollup: rollupRoute };

describe("internal scan step routes: auth", () => {
  it.each(Object.entries(routes))("%s returns 401 without the cron bearer", async (_name, handler) => {
    const body = { workspaceId: WS, sourceId: SRC, leaseToken: TOKEN };
    expect((await call(handler, body, {})).status).toBe(401);
    expect((await call(handler, body, { authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("fails closed when CRON_SECRET is unset, even outside production", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await call(dueRoute, undefined, { authorization: "Bearer " });
    expect(response.status).toBe(401);
    expect(state.writes).toEqual([]);
  });
});

describe("internal scan step routes: validation", () => {
  it("rejects invalid JSON and non-UUID identifiers with 400", async () => {
    expect((await call(planRoute, "{not json")).status).toBe(400);
    expect((await call(planRoute, { workspaceId: "ws-1" })).status).toBe(400);
    expect((await call(collectRoute, { workspaceId: WS, sourceId: 42 })).status).toBe(400);
    expect((await call(finishRoute, { workspaceId: WS, leaseToken: "not-a-token" })).status).toBe(400);
  });
});

describe("due", () => {
  it("returns workspaces whose cadence has elapsed", async () => {
    const response = await call(dueRoute);
    expect(await response.json()).toEqual({ workspaceIds: [WS] });
  });

  it("only considers workspaces that have a monitoring profile", async () => {
    await call(dueRoute);
    const sqlText = toSql(state.dueWhere).sql;
    expect(sqlText).toMatch(/exists \(select 1 from "monitoring_profile"/);
  });

  it("returns none and rotates not-due workspaces to the back of the queue", async () => {
    state.lastPolled = new Date();
    const response = await call(dueRoute);
    expect(await response.json()).toEqual({ workspaceIds: [] });
    expect(state.writes.some((write) => write.table === "workspace" && "updatedAt" in write.set)).toBe(true);
  });
});

describe("plan", () => {
  it("claims a 30-minute lease and returns up to 40 eligible source ids", async () => {
    state.eligible = Array.from({ length: 40 }, (_, index) => ({ id: `source-${index}` }));
    const response = await call(planRoute, { workspaceId: WS });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.leaseToken).toMatch(UUID_RE);
    expect(body.sourceIds).toHaveLength(40);
    expect(state.limits).toContain(40);
    const claim = state.writes.find((write) => write.table === "workspace" && "scanLeaseToken" in write.set);
    expect(claim?.set).toMatchObject({ scanLeaseToken: body.leaseToken });
    expect(toSql(claim?.set.scanLeaseUntil).params).toContain(30);
  });

  it("returns 409 while another lease is held", async () => {
    state.leaseHeld = true;
    const response = await call(planRoute, { workspaceId: WS });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "scan already running" });
  });

  it("returns skipped without claiming a lease when no monitoring profile exists, and rotates the workspace", async () => {
    state.profile = false;
    const response = await call(planRoute, { workspaceId: WS });
    expect(await response.json()).toEqual({ skipped: true, reason: "monitoring profile required" });
    // Only a rotation write: no lease is claimed, and updatedAt moves the workspace to the back of the due queue.
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({ table: "workspace" });
    expect(state.writes[0]!.set).toEqual({ updatedAt: expect.any(Date) });
    expect(state.writes[0]!.set).not.toHaveProperty("scanLeaseToken");
  });

  it("returns skipped when the workspace is not due", async () => {
    state.lastPolled = new Date();
    const response = await call(planRoute, { workspaceId: WS });
    expect(await response.json()).toEqual({ skipped: true, reason: "free plan scans at most every 24 hours" });
    expect(state.writes).toEqual([]);
  });
});

describe("collect", () => {
  it("returns inserted and skipped counts", async () => {
    const response = await call(collectRoute, { workspaceId: WS, sourceId: SRC });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ inserted: 2, skipped: 0 });
  });

  it("inserts no duplicate documents when the same source is collected twice", async () => {
    await call(collectRoute, { workspaceId: WS, sourceId: SRC });
    const second = await call(collectRoute, { workspaceId: WS, sourceId: SRC });
    expect(await second.json()).toEqual({ inserted: 0, skipped: 2 });
  });

  it("returns 502 without leaking the collector error when the collector fails", async () => {
    state.collectorRun = vi.fn(async () => { throw new Error("upstream secret-token-value"); });
    const response = await call(collectRoute, { workspaceId: WS, sourceId: SRC });
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("secret-token-value");
  });

  it("returns 404 for a source that does not belong to the workspace", async () => {
    state.sourceRow = null;
    const response = await call(collectRoute, { workspaceId: WS, sourceId: SRC });
    expect(response.status).toBe(404);
    expect(state.collectorRun).not.toHaveBeenCalled();
  });
});

describe("embed", () => {
  it("returns the embedded count", async () => {
    expect(await (await call(embedRoute, { workspaceId: WS })).json()).toEqual({ embedded: 3 });
  });

  it("stays 200 when semantic indexing fails", async () => {
    state.embed = vi.fn(async () => { throw new Error("ai binding unavailable"); });
    const response = await call(embedRoute, { workspaceId: WS });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ embedded: 0 });
  });
});

describe("build", () => {
  it("returns the buildOpportunities result", async () => {
    const response = await call(buildRoute, { workspaceId: WS });
    expect(await response.json()).toEqual({ scanned: 2, clusters: 1, upserted: 1, top: [] });
    expect(state.build).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WS, limitDocs: 50 }));
  });

  it("returns 500 without details when the build throws", async () => {
    state.build = vi.fn(async () => { throw new Error("database failed"); });
    const response = await call(buildRoute, { workspaceId: WS });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("database failed");
  });
});

describe("finish", () => {
  it("releases only the lease that carries the supplied token", async () => {
    const response = await call(finishRoute, { workspaceId: WS, leaseToken: TOKEN });
    expect(await response.json()).toEqual({ released: true });
    const release = state.writes.find((write) => write.table === "workspace" && write.set.scanLeaseToken === null);
    expect(release).toBeDefined();
    const condition = toSql(release?.where);
    expect(condition.params).toContain(TOKEN);
    expect(condition.sql).toContain('"scan_lease_token"');
  });
});

describe("rollup", () => {
  it("runs the cost rollup and returns ok", async () => {
    const response = await call(rollupRoute);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.rollup).toHaveBeenCalledTimes(1);
  });

  it("does not run the rollup without the cron bearer", async () => {
    expect((await call(rollupRoute, undefined, {})).status).toBe(401);
    expect(state.rollup).not.toHaveBeenCalled();
  });
});
