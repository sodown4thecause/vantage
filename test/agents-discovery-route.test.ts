import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb } from "./helpers/fake-db";

const state = vi.hoisted(() => ({
  authorize: vi.fn(),
  run: vi.fn(),
  save: vi.fn(),
  ingest: vi.fn(),
  capture: vi.fn(),
  db: undefined as unknown,
}));

vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: state.authorize }));
vi.mock("@/lib/analytics/server", () => ({ captureServerException: state.capture }));
vi.mock("@/lib/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/lib/agents/discovery", async (original) => ({
  ...await original<typeof import("@/lib/agents/discovery")>(),
  runDiscovery: state.run,
  saveDiscoveryProposals: state.save,
  ingestReviewedSources: state.ingest,
}));

import { GET, POST } from "@/app/api/discovery/route";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

const WS = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown) => new Request("https://contextfor.dev/api/discovery", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const outcome = {
  status: "complete", competitors: [], keywords: [], sources: [], modelCostUsd: 0.012, toolSpendUsd: 0.004,
  results: [{ kind: "profile", status: "proposed", proposal: { productName: "Vantage" } }],
};

beforeEach(() => {
  for (const mock of [state.authorize, state.run, state.save, state.ingest, state.capture]) mock.mockReset();
  state.authorize.mockResolvedValue({ ok: true, userId: "u" });
  state.run.mockResolvedValue(outcome);
  state.save.mockResolvedValue(undefined);
  state.ingest.mockResolvedValue({ ingested: ["HN: syften alternative"], waiting: [] });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("the route must not fetch sites itself"); }));
});

describe("POST /api/discovery", () => {
  it("rejects bad input before authorising or spending anything", async () => {
    for (const body of ["not json", { productUrl: "https://contextfor.dev/" }, { workspaceId: WS }, { workspaceId: WS, productUrl: "http://localhost/admin" }, { workspaceId: "x", productUrl: "https://contextfor.dev/" }]) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
    }
    expect(state.authorize).not.toHaveBeenCalled();
    expect(state.run).not.toHaveBeenCalled();
  });

  it("refuses a workspace the caller does not own without running the agent", async () => {
    state.authorize.mockResolvedValue({ ok: false, status: 403, error: "forbidden" });
    const res = await POST(post({ workspaceId: WS, productUrl: "https://contextfor.dev/" }));
    expect(res.status).toBe(403);
    expect(state.run).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("runs discovery, stores the proposals, ingests gated sources and returns typed results", async () => {
    const res = await POST(post({ workspaceId: WS, productUrl: "https://contextfor.dev/" }));
    expect(res.status).toBe(200);
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WS, productUrl: "https://contextfor.dev/", kind: "initial" }));
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WS, productUrl: "https://contextfor.dev/", outcome }));
    expect(state.ingest).toHaveBeenCalledWith(WS);
    expect(await res.json()).toMatchObject({ status: "complete", results: outcome.results, ingested: ["HN: syften alternative"], spend: { modelUsd: 0.012, toolsUsd: 0.004 } });
  });

  it("stores nothing when the budget is used up", async () => {
    state.run.mockRejectedValue(new PaidCallDeniedError("budget_exhausted", "used up"));
    const res = await POST(post({ workspaceId: WS, productUrl: "https://contextfor.dev/" }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "discovery_budget_used" });
    expect(state.save).not.toHaveBeenCalled();
  });

  it("reports a missing gateway key as not configured, and a disabled provider as unavailable", async () => {
    state.run.mockResolvedValue({ ...outcome, status: "not_configured" });
    expect((await POST(post({ workspaceId: WS, productUrl: "https://contextfor.dev/" }))).status).toBe(503);
    state.run.mockRejectedValue(new PaidCallDeniedError("provider_disabled", "off"));
    expect((await POST(post({ workspaceId: WS, productUrl: "https://contextfor.dev/" }))).status).toBe(503);
    expect(state.save).not.toHaveBeenCalled();
  });

  it("returns a generic error and records the exception on an unexpected failure", async () => {
    state.run.mockRejectedValue(new Error("secret internals"));
    const res = await POST(post({ workspaceId: WS, productUrl: "https://contextfor.dev/" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(state.capture).toHaveBeenCalled();
  });
});

describe("GET /api/discovery", () => {
  const get = (workspaceId?: string) => GET(new Request(`https://contextfor.dev/api/discovery${workspaceId ? `?workspaceId=${workspaceId}` : ""}`));

  it("needs a workspace id and authorisation", async () => {
    expect((await get()).status).toBe(400);
    state.authorize.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    expect((await get(WS)).status).toBe(401);
  });

  it("returns the workspace's pending proposals, reading with the workspace id in every query", async () => {
    const fake = fakeDb([[{ id: "p1" }], [{ id: "c1" }], [{ id: "k1" }], [{ id: "s1" }]]);
    state.db = fake.db;
    const res = await get(WS);
    expect(await res.json()).toEqual({ profile: { id: "p1" }, competitors: [{ id: "c1" }], keywords: [{ id: "k1" }], sources: [{ id: "s1" }] });
    expect(fake.ops).toHaveLength(4);
    for (const op of fake.ops) expect(op.where!.params).toContain(WS);
  });
});
