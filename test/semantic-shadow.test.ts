import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  mode: "off" as "off" | "shadow" | "on",
  ai: null as unknown,
  vectorize: null as unknown,
  docs: [] as Row[],
  profile: null as unknown,
  shadow: [] as Row[],
  opportunityWrites: [] as Row[],
  evidence: [] as Row[],
  embedPending: vi.fn<(...args: unknown[]) => Promise<{ embedded: number }>>(async () => ({ embedded: 0 })),
}));

vi.mock("@/lib/cf/env", () => ({
  getAi: async () => state.ai,
  getVectorize: async () => state.vectorize,
  getSemanticMode: () => state.mode,
}));
vi.mock("@/lib/costs/ledger", () => ({
  recordCost: async () => true,
}));
vi.mock("@/lib/costs/prices", () => ({
  getUnitCost: async () => 0.0118,
}));
vi.mock("@/lib/embeddings/index-documents", () => ({
  embedPendingDocuments: (...args: unknown[]) => state.embedPending(...args),
}));
vi.mock("@/lib/profile/repository", () => ({
  getLatestMonitoringProfile: async () => state.profile,
}));
vi.mock("@/lib/learning/repository", () => ({
  getActivePreferenceModel: async () => null,
}));
vi.mock("@/lib/plans/limits", () => ({
  consume: async () => ({ allowed: true }),
  release: async () => undefined,
}));

// Minimal drizzle-shaped fake: select/update/delete chains resolve to the rows
// they target, and inserts into semanticShadow honour the (documentId, mode)
// unique index so repeated runs are observable.
vi.mock("@/lib/db/client", async () => {
  const schema = await import("@/lib/db/schema");
  type Step = (...args: unknown[]) => Chain;
  type Chain = PromiseLike<unknown[]> & {
    from: Step;
    innerJoin: Step;
    where: Step;
    orderBy: Step;
    limit: Step;
    returning: Step;
    onConflictDoNothing: Step;
  };

  function chain(resolve: () => unknown[]): Chain {
    const c: Chain = {
      from: () => c,
      innerJoin: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      returning: () => c,
      onConflictDoNothing: () => c,
      then: (onFulfilled, onRejected) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };
    return c;
  }

  function rowsFor(table: unknown): unknown[] {
    return table === schema.document ? state.docs.map((r) => ({ ...r })) : [];
  }

  function applyInsert(table: unknown, values: unknown): unknown[] {
    const rows = (Array.isArray(values) ? values : [values]) as Row[];
    if (table === schema.semanticShadow) {
      const inserted: Row[] = [];
      for (const row of rows) {
        const duplicate = state.shadow.some((s) => s.documentId === row.documentId && s.mode === row.mode);
        if (duplicate) continue;
        state.shadow.push({ ...row });
        inserted.push({ id: `shadow-${state.shadow.length}` });
      }
      return inserted;
    }
    if (table === schema.opportunity) {
      state.opportunityWrites.push(...rows.map((r) => ({ ...r })));
      return rows.map((_, i) => ({ id: `opp-${state.opportunityWrites.length}-${i}` }));
    }
    if (table === schema.opportunityEvidence) {
      state.evidence.push(...rows.map((r) => ({ ...r })));
      return rows.map(() => ({ id: "evidence" }));
    }
    return [];
  }

  return {
    getDb: () => ({
      select: () => ({ from: (table: unknown) => chain(() => rowsFor(table)) }),
      insert: (table: unknown) => ({ values: (values: unknown) => chain(() => applyInsert(table, values)) }),
      update: () => ({ set: () => ({ where: () => chain(() => []) }) }),
      delete: () => ({ where: () => chain(() => []) }),
    }),
  };
});

import { classifyIntent } from "@/lib/pipeline/intent-ladder";
import type { NormalizedDocument } from "@/lib/pipeline/normalize";
import { runSemanticStage } from "@/lib/pipeline/shadow";
import { buildOpportunities } from "@/lib/opportunities/run";
import { createFakeAi } from "./helpers/fake-ai";
import { createFakeVectorize } from "./helpers/fake-vectorize";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
const TEXTS = [
  "Looking to buy a social listening tool for brand monitoring",
  "Anyone recommend a social listening tool for tracking mentions?",
  "random chatter without buying signals",
];

function normalized(i: number): NormalizedDocument {
  return {
    id: IDS[i],
    workspaceId: WORKSPACE,
    urlCanonical: `https://example.com/${i}`,
    platform: "reddit",
    title: `Post ${i}`,
    authorRef: null,
    postedAt: new Date("2026-10-07T12:00:00.000Z"),
    text: `Post ${i} ${TEXTS[i]}`,
    contentHash: `hash-${i}`,
  };
}

function docRow(i: number): Row {
  return {
    id: IDS[i],
    workspaceId: WORKSPACE,
    urlCanonical: `https://example.com/${i}`,
    platform: "reddit",
    title: `Post ${i}`,
    contentMd: TEXTS[i],
    authorRef: null,
    postedAt: new Date(NOW.getTime() - 3600_000),
    collectedAt: NOW,
    contentHash: `hash-${i}`,
    metadata: {},
    sourceId: null,
    embeddedAt: null,
    embeddingModel: null,
  };
}

const NOW = new Date("2026-10-08T12:00:00.000Z");

const DOCS = [0, 1, 2].map(normalized);

beforeEach(() => {
  vi.clearAllMocks();
  // Feature timing reads Date.now(), so freeze the clock for identical-output comparisons.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  state.mode = "off";
  state.ai = null;
  state.vectorize = null;
  state.docs = [0, 1, 2].map(docRow);
  state.profile = {
    version: 1,
    productDescription: "Social listening and brand monitoring",
    targetCustomer: "Teams",
    topics: ["social listening"],
    competitors: [],
  };
  state.shadow = [];
  state.opportunityWrites = [];
  state.evidence = [];
});

describe("runSemanticStage", () => {
  it("makes no AI call and returns null when the mode is off", async () => {
    const ai = createFakeAi();
    state.ai = ai.binding;
    state.vectorize = createFakeVectorize().binding;

    const result = await runSemanticStage(WORKSPACE, DOCS);

    expect(result).toBeNull();
    expect(ai.calls).toHaveLength(0);
    expect(state.embedPending).not.toHaveBeenCalled();
    expect(state.shadow).toHaveLength(0);
  });

  it("records one shadow row per document with the keyword rung and semantic values", async () => {
    state.mode = "shadow";
    const ai = createFakeAi();
    state.ai = ai.binding;
    state.vectorize = createFakeVectorize().binding;

    const signals = await runSemanticStage(WORKSPACE, DOCS);

    expect(signals).not.toBeNull();
    expect(state.embedPending).toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ limit: 200 }));
    // This run's documents are embedded from their text, not read back from Vectorize.
    const embeddedTexts = ai.calls.flatMap((call) => call.text);
    for (const doc of DOCS) expect(embeddedTexts).toContain(doc.text);

    expect(state.shadow).toHaveLength(3);
    DOCS.forEach((doc, i) => {
      const row = state.shadow.find((r) => r.documentId === doc.id);
      expect(row).toMatchObject({
        workspaceId: WORKSPACE,
        mode: "shadow",
        keywordRung: classifyIntent(doc).intentRung,
        semanticFit: signals?.get(doc.id)?.fit,
        semanticRung: signals?.get(doc.id)?.rung ?? null,
        anchorSimilarity: signals?.get(doc.id)?.anchorSimilarity ?? null,
      });
      expect(typeof row?.semanticFit).toBe("number");
      if (i === 0) expect(row?.keywordRung).toBe(4);
      if (i === 2) expect(row?.keywordRung).toBe(0);
    });
  });

  it("does not duplicate shadow rows when the stage runs again", async () => {
    state.mode = "shadow";
    state.ai = createFakeAi().binding;
    state.vectorize = createFakeVectorize().binding;

    await runSemanticStage(WORKSPACE, DOCS);
    await runSemanticStage(WORKSPACE, DOCS);

    expect(state.shadow).toHaveLength(3);
  });

  it("returns null and records nothing when the AI call fails", async () => {
    state.mode = "shadow";
    state.ai = createFakeAi({ throws: new Error("AI outage") }).binding;
    state.vectorize = createFakeVectorize().binding;

    await expect(runSemanticStage(WORKSPACE, DOCS)).resolves.toBeNull();
    expect(state.shadow).toHaveLength(0);
  });

  it("returns null and records nothing when Vectorize is unavailable", async () => {
    state.mode = "shadow";
    state.ai = createFakeAi().binding;
    state.vectorize = null;

    await expect(runSemanticStage(WORKSPACE, DOCS)).resolves.toBeNull();
    expect(state.shadow).toHaveLength(0);
  });

  it("never throws when pending embedding fails", async () => {
    state.mode = "shadow";
    state.ai = createFakeAi().binding;
    state.vectorize = createFakeVectorize().binding;
    state.embedPending.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(runSemanticStage(WORKSPACE, DOCS)).resolves.toBeNull();
    expect(state.shadow).toHaveLength(0);
  });
});

describe("buildOpportunities with shadow mode", () => {
  it("produces the same opportunity rows as mode off", async () => {
    state.mode = "off";
    const off = await buildOpportunities({ workspaceId: WORKSPACE });
    const offWrites = structuredClone(state.opportunityWrites);
    expect(state.shadow).toHaveLength(0);

    state.opportunityWrites = [];
    state.mode = "shadow";
    state.ai = createFakeAi().binding;
    state.vectorize = createFakeVectorize().binding;
    const shadow = await buildOpportunities({ workspaceId: WORKSPACE });

    expect(shadow).toEqual(off);
    expect(state.opportunityWrites).toEqual(offWrites);
    expect(offWrites.length).toBeGreaterThan(0);
    expect(state.shadow).toHaveLength(3);
  });

  it("still returns the normal result when the AI call fails", async () => {
    state.mode = "off";
    const off = await buildOpportunities({ workspaceId: WORKSPACE });
    const offWrites = structuredClone(state.opportunityWrites);

    state.opportunityWrites = [];
    state.mode = "shadow";
    state.ai = createFakeAi({ throws: new Error("AI outage") }).binding;
    state.vectorize = createFakeVectorize().binding;
    const outage = await buildOpportunities({ workspaceId: WORKSPACE });

    expect(outage).toEqual(off);
    expect(state.opportunityWrites).toEqual(offWrites);
    expect(state.shadow).toHaveLength(0);
  });
});

describe("buildOpportunities near-duplicate collapse", () => {
  it("keeps evidence for every near-duplicate document in on mode", async () => {
    // Identical text gives identical vectors, so all three documents are mutual near-duplicates.
    state.docs = [0, 1, 2].map((i) => ({ ...docRow(i), title: "Post", contentMd: TEXTS[0] }));
    state.mode = "on";
    state.ai = createFakeAi().binding;
    state.vectorize = createFakeVectorize().binding;

    const result = await buildOpportunities({ workspaceId: WORKSPACE });

    expect(result.clusters).toBe(1);
    expect(result.upserted).toBe(1);
    expect(state.evidence.map((e) => e.documentId).sort()).toEqual([...IDS].sort());
    // Scoring sees one representative: log2(1 + 1) / 4 = 0.25. Without the collapse, three documents give 0.5.
    const features = state.opportunityWrites[0].features as { evidence: number };
    expect(features.evidence).toBeCloseTo(0.25);
  });
});
