import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ai: null as unknown,
  vectorize: null as unknown,
}));

vi.mock("@/lib/cf/env", () => ({
  getAi: async () => state.ai,
  getVectorize: async () => state.vectorize,
}));
vi.mock("@/lib/costs/ledger", () => ({
  recordCost: async () => true,
}));
vi.mock("@/lib/costs/prices", () => ({
  getUnitCost: async () => 0.0118,
}));

import { createFakeAi, fakeVector } from "./helpers/fake-ai";
import { createFakeVectorize } from "./helpers/fake-vectorize";

const WORKSPACE = "ws-1";
const OTHER_WORKSPACE = "ws-2";
const HN_RUNG_3 = "anything better than Mention for tracking HN?";

// The module memoises anchor vectors, so each test loads a fresh copy.
async function load() {
  vi.resetModules();
  const semantic = await import("@/lib/pipeline/semantic");
  const anchors = await import("@/lib/pipeline/anchors");
  const store = await import("@/lib/embeddings/store");
  return { ...semantic, ...anchors, ...store };
}

beforeEach(() => {
  state.ai = null;
  state.vectorize = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("cosine", () => {
  it("returns 1 for identical vectors", async () => {
    const { cosine } = await load();
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", async () => {
    const { cosine } = await load();
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("returns 0 when either vector is the zero vector", async () => {
    const { cosine } = await load();
    expect(cosine([0, 0], [1, 2])).toBe(0);
    expect(cosine([1, 2], [0, 0])).toBe(0);
  });

  it("throws on mismatched lengths", async () => {
    const { cosine } = await load();
    expect(() => cosine([1], [1, 2])).toThrow();
  });
});

describe("anchors and thresholds", () => {
  it("has at least four phrases per rung from 1 to 4, including the HN comparison phrase at rung 3", async () => {
    const { ANCHORS } = await load();
    for (const rung of [1, 2, 3, 4] as const) {
      expect(ANCHORS.filter((a) => a.rung === rung).length).toBeGreaterThanOrEqual(4);
    }
    expect(ANCHORS).toContainEqual({ rung: 3, text: HN_RUNG_3 });
  });

  it("uses the provisional thresholds from the brief", async () => {
    const { SEMANTIC_THRESHOLDS } = await load();
    expect(SEMANTIC_THRESHOLDS).toEqual({ anchor: 0.6, fit: 0.5, duplicate: 0.92 });
  });
});

describe("loadAnchorVectors", () => {
  it("returns one vector per anchor and calls the embed binding once across two invocations", async () => {
    const { loadAnchorVectors, ANCHORS } = await load();
    const ai = createFakeAi();
    state.ai = ai.binding;

    const first = await loadAnchorVectors();
    const second = await loadAnchorVectors();

    expect(first).toHaveLength(ANCHORS.length);
    expect(first?.[0].rung).toBe(ANCHORS[0].rung);
    expect(first?.[0].values).toEqual(fakeVector(ANCHORS[0].text));
    expect(second).toEqual(first);
    expect(ai.calls).toHaveLength(1);
  });

  it("returns null when the AI binding is absent", async () => {
    const { loadAnchorVectors } = await load();
    expect(await loadAnchorVectors()).toBeNull();
  });

  it("does not memoise a failure, so a later call with AI available succeeds", async () => {
    const { loadAnchorVectors, ANCHORS } = await load();
    expect(await loadAnchorVectors()).toBeNull();

    const ai = createFakeAi();
    state.ai = ai.binding;
    const vectors = await loadAnchorVectors();

    expect(vectors).toHaveLength(ANCHORS.length);
    expect(ai.calls).toHaveLength(1);
  });
});

describe("semanticSignals", () => {
  it("maps a document identical to an anchor onto that anchor's rung with similarity 1", async () => {
    const { semanticSignals } = await load();
    state.ai = createFakeAi().binding;
    state.vectorize = createFakeVectorize().binding;

    const signals = await semanticSignals(WORKSPACE, [
      { id: "doc-1", vector: fakeVector(HN_RUNG_3) },
    ]);

    const signal = signals?.get("doc-1");
    expect(signal?.rung).toBe(3);
    expect(signal?.anchorSimilarity).toBeCloseTo(1, 6);
    expect(signal?.documentId).toBe("doc-1");
  });

  it("yields rung null for a document far from every anchor", async () => {
    const { semanticSignals, SEMANTIC_THRESHOLDS } = await load();
    state.ai = createFakeAi().binding;
    state.vectorize = createFakeVectorize().binding;

    const signals = await semanticSignals(WORKSPACE, [
      { id: "far", vector: fakeVector("sourdough starter hydration ratios for beginners") },
    ]);

    const signal = signals?.get("far");
    expect(signal?.rung).toBeNull();
    expect(signal?.anchorSimilarity).toBeLessThan(SEMANTIC_THRESHOLDS.anchor);
  });

  it("sets fit to the best cosine against the workspace's profile vectors", async () => {
    const { semanticSignals, upsertVectors, cosine } = await load();
    state.ai = createFakeAi().binding;
    const vz = createFakeVectorize();
    state.vectorize = vz.binding;

    const docVector = fakeVector("someone asking about invoice reminders");
    const profileA = fakeVector("invoice reminders for freelancers");
    const profileB = fakeVector("late payment follow-up");
    await upsertVectors(WORKSPACE, [
      { id: "profile:p1:0", values: profileA, kind: "profile" },
      { id: "profile:p1:1", values: profileB, kind: "profile" },
    ]);

    const signals = await semanticSignals(WORKSPACE, [{ id: "doc-1", vector: docVector }]);

    const expected = Math.max(cosine(docVector, profileA), cosine(docVector, profileB));
    expect(signals?.get("doc-1")?.fit).toBeCloseTo(expected, 6);
    const query = vz.calls.find((c) => c.op === "query" && c.options.filter?.kind === "profile");
    expect(query?.op === "query" && query.options).toEqual({
      topK: 3,
      namespace: WORKSPACE,
      filter: { kind: "profile" },
    });
  });

  it("ignores profile vectors that belong to another workspace", async () => {
    const { semanticSignals, upsertVectors } = await load();
    state.ai = createFakeAi().binding;
    state.vectorize = createFakeVectorize().binding;

    const docVector = fakeVector("shared text");
    await upsertVectors(OTHER_WORKSPACE, [{ id: "profile:p9:0", values: docVector, kind: "profile" }]);

    const signals = await semanticSignals(WORKSPACE, [{ id: "doc-1", vector: docVector }]);

    expect(signals?.get("doc-1")?.fit).toBe(0);
  });

  it("sets fit to 0 when the workspace has no profile vectors", async () => {
    const { semanticSignals } = await load();
    state.ai = createFakeAi().binding;
    state.vectorize = createFakeVectorize().binding;

    const signals = await semanticSignals(WORKSPACE, [
      { id: "doc-1", vector: fakeVector(HN_RUNG_3) },
    ]);

    expect(signals?.get("doc-1")?.fit).toBe(0);
  });

  it("returns null when the Vectorize binding is absent", async () => {
    const { semanticSignals } = await load();
    state.ai = createFakeAi().binding;

    const signals = await semanticSignals(WORKSPACE, [
      { id: "doc-1", vector: fakeVector(HN_RUNG_3) },
    ]);

    expect(signals).toBeNull();
  });

  it("returns null when the AI binding is absent", async () => {
    const { semanticSignals } = await load();
    state.vectorize = createFakeVectorize().binding;

    const signals = await semanticSignals(WORKSPACE, [
      { id: "doc-1", vector: fakeVector(HN_RUNG_3) },
    ]);

    expect(signals).toBeNull();
  });

  it("returns a neutral signal for a document with an empty vector instead of throwing", async () => {
    const { semanticSignals } = await load();
    state.ai = createFakeAi().binding;
    state.vectorize = createFakeVectorize().binding;

    const signals = await semanticSignals(WORKSPACE, [{ id: "blank", vector: [] }]);

    expect(signals?.get("blank")).toEqual({
      documentId: "blank",
      fit: 0,
      rung: null,
      anchorSimilarity: null,
    });
  });
});
