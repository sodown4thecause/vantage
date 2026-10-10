import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentRecord, Opportunity, OpportunityEvidence } from "@/lib/db/schema";

type Op = { name: string; args: unknown[] };
const state = vi.hoisted(() => ({
  documents: [] as DocumentRecord[],
  opportunities: [] as Opportunity[],
  evidence: [] as OpportunityEvidence[],
  profile: true,
}));

// Persist the real builder's rows, rather than returning canned digest entries.
// This seam exercises result-boundary behavior, not PostgreSQL's SQL execution.
vi.mock("@/lib/db/client", () => {
  const query = (resolve: (ops: Op[]) => unknown, ops: Op[]) => {
    const builder: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          return (ok: (value: unknown) => unknown, bad: (error: unknown) => unknown) =>
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
      insert: (...args: unknown[]) => query(insertRows, [{ name: "insert", args }]),
      update: () => query(() => undefined, []),
      delete: () => query(() => undefined, []),
    }),
  };
});
vi.mock("@/lib/profile/repository", () => ({
  getLatestMonitoringProfile: async () => state.profile ? {
    version: 1,
    productDescription: "Agent evaluation benchmarks",
    targetCustomer: "Teams",
    topics: ["agent evaluation"],
    competitors: [],
  } : null,
}));
vi.mock("@/lib/plans/limits", () => ({
  consume: async () => ({ allowed: true }),
  release: async () => undefined,
}));
vi.mock("@/lib/learning/repository", () => ({ getActivePreferenceModel: async () => null }));
vi.mock("@/lib/cf/env", () => ({ getSemanticMode: () => "off" }));
vi.mock("@/lib/pipeline/shadow", () => ({ runSemanticStageDetailed: async () => null }));

import { document, opportunity, opportunityEvidence } from "@/lib/db/schema";
import { buildOpportunities } from "@/lib/opportunities/run";
import { selectDigestOpportunities } from "@/lib/digest/select";

const now = new Date("2026-10-10T13:00:00.000Z");
const since = new Date("2026-10-09T13:00:00.000Z");
const workspaceId = "workspace-1";
const op = (ops: Op[], name: string) => ops.find((entry) => entry.name === name)?.args[0];

function readRows(ops: Op[]) {
  const table = op(ops, "from");
  const limit = op(ops, "limit");
  if (table === document) return state.documents;
  if (table === opportunity) return state.opportunities.slice(0, typeof limit === "number" ? limit : undefined);
  if (table === opportunityEvidence) {
    return state.evidence.flatMap((evidence) => {
      const doc = state.documents.find((item) => item.id === evidence.documentId);
      return doc ? [{ opportunityId: evidence.opportunityId, workspaceId: evidence.workspaceId, doc }] : [];
    });
  }
  // The retired lead table deliberately contains no rows: ordinary scans do not write it.
  return [];
}

function insertRows(ops: Op[]) {
  const table = op(ops, "insert");
  if (table === opportunity) {
    const values = op(ops, "values") as Partial<Opportunity>;
    const row = card(`opportunity-${state.opportunities.length + 1}`, values);
    state.opportunities.push(row);
    return [{ id: row.id }];
  }
  if (table === opportunityEvidence) {
    const values = op(ops, "values") as Array<Omit<OpportunityEvidence, "id" | "createdAt">>;
    state.evidence.push(...values.map((value, index) => ({ ...value, id: `evidence-${index}`, createdAt: now })));
  }
  return [];
}

function doc(id: string, overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id, workspaceId, sourceId: null, platform: "reddit", authorRef: null,
    title: "Looking for agent evaluation", urlCanonical: `https://example.com/${id}`,
    contentMd: "Need reliable agent evaluation benchmarks. What should I buy?",
    contentHash: id, rawSnapshotRef: null, metadata: { provider: "scavio" },
    postedAt: now, collectedAt: now, createdAt: now, embeddingModel: null, embeddedAt: null,
    ...overrides,
  };
}

function card(id: string, overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id, workspaceId, status: "opportunity", title: "Queue card", summary: "",
    whyItMatters: "Relevant to agent evaluation", whyNow: "", recommendedAction: "",
    confidence: 0.9, urgency: 0.9, score: 0.9, coverage: "scavio",
    features: { profileVersion: 1 }, clusterKey: id, createdAt: now, updatedAt: now,
    ...overrides,
  };
}

function link(opportunityId: string, documentId: string, scope = workspaceId) {
  state.evidence.push({ id: `${opportunityId}-${documentId}`, workspaceId: scope, opportunityId, documentId, createdAt: now });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  state.documents = [];
  state.opportunities = [];
  state.evidence = [];
  state.profile = true;
});
afterEach(() => vi.useRealTimers());

describe("selectDigestOpportunities", () => {
  it("selects an opportunity and its source evidence produced by the ordinary scan builder", async () => {
    state.documents = [doc("source-conversation")];
    const built = await buildOpportunities({ workspaceId });
    expect(built.upserted).toBe(1);
    expect(built.top).toHaveLength(1);

    const entries = await selectDigestOpportunities(workspaceId, { since });
    expect(entries).toEqual([{
      opportunityId: state.opportunities[0]!.id,
      score: state.opportunities[0]!.score,
      reason: state.opportunities[0]!.whyItMatters,
      title: "Looking for agent evaluation", platform: "reddit",
      url: "https://example.com/source-conversation",
    }]);
  });

  it("preserves queue rank, limits digests to five, and chooses one stable source per card", async () => {
    state.opportunities = Array.from({ length: 6 }, (_, index) => card(`rank-${index}`, { score: 0.9 - index / 10 }));
    state.documents = [doc("z-source"), doc("a-source")];
    for (const row of state.opportunities) {
      link(row.id, "z-source");
      link(row.id, "a-source");
    }
    const entries = await selectDigestOpportunities(workspaceId, { since, limit: 20 });
    expect(entries.map((entry) => entry.opportunityId)).toEqual(["rank-0", "rank-1", "rank-2", "rank-3", "rank-4"]);
    expect(entries.every((entry) => entry.url === "https://example.com/a-source")).toBe(true);
  });

  it("rejects foreign cards and any card with foreign or synthetic evidence", async () => {
    state.opportunities = [card("foreign-card", { workspaceId: "workspace-2" }), card("foreign-link"), card("foreign-document"), card("fixture"), card("mocked")];
    state.documents = [doc("live"), doc("foreign", { workspaceId: "workspace-2" }), doc("fixture", { metadata: { provider: "fixture" } }), doc("mocked", { metadata: { mocked: true } })];
    link("foreign-card", "live");
    link("foreign-link", "live", "workspace-2");
    link("foreign-document", "foreign");
    link("fixture", "live");
    link("mocked", "live");
    link("fixture", "fixture");
    link("mocked", "mocked");
    await expect(selectDigestOpportunities(workspaceId, { since })).resolves.toEqual([]);
  });

  it("rejects ignored, obsolete-profile, stale, future and evidence-free cards", async () => {
    state.opportunities = [card("ignored", { status: "ignore" }), card("obsolete", { features: { profileVersion: 0 } }), card("old", { updatedAt: new Date(since.getTime() - 1) }), card("future"), card("empty")];
    state.documents = [doc("live"), doc("future", { postedAt: new Date(now.getTime() + 300_001) })];
    link("ignored", "live");
    link("obsolete", "live");
    link("old", "live");
    link("future", "future");
    await expect(selectDigestOpportunities(workspaceId, { since })).resolves.toEqual([]);
  });

  it("rejects cards whose evidence has aged out of the live queue", async () => {
    state.opportunities = [card("stale-evidence")];
    state.documents = [doc("stale", { postedAt: new Date(now.getTime() - 7 * 86400_000 - 1) })];
    link("stale-evidence", "stale");
    await expect(selectDigestOpportunities(workspaceId, { since })).resolves.toEqual([]);
  });

  it("includes refreshed clusters at the 24-hour boundary and review/monitor cards", async () => {
    state.opportunities = [card("review", { status: "review", createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: since }), card("monitor", { status: "monitor" })];
    state.documents = [doc("live", { postedAt: null })];
    link("review", "live");
    link("monitor", "live");
    expect((await selectDigestOpportunities(workspaceId, { since })).map((entry) => entry.opportunityId)).toEqual(["review", "monitor"]);
  });

  it("returns nothing without a current workspace profile", async () => {
    state.profile = false;
    await expect(selectDigestOpportunities(workspaceId, { since })).resolves.toEqual([]);
  });
});
