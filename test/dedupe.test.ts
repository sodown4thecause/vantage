import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  vectorize: null as unknown,
}));

vi.mock("@/lib/cf/env", () => ({
  getAi: async () => null,
  getVectorize: async () => state.vectorize,
  getSemanticMode: () => "off",
}));
vi.mock("@/lib/costs/ledger", () => ({
  recordCost: async () => true,
}));
vi.mock("@/lib/costs/prices", () => ({
  getUnitCost: async () => 0,
}));

import { nearDuplicates, olderNeighbours } from "@/lib/pipeline/dedupe";
import { SEMANTIC_THRESHOLDS } from "@/lib/pipeline/semantic";
import { upsertVectors } from "@/lib/embeddings/store";
import { createFakeVectorize } from "./helpers/fake-vectorize";

const WS = "ws-a";

/** Unit vector at an angle in degrees: cosine between two such vectors is cos(angle difference). */
function at(deg: number): number[] {
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

beforeEach(() => {
  state.vectorize = null;
});

describe("nearDuplicates", () => {
  it("uses the duplicate threshold from SEMANTIC_THRESHOLDS", () => {
    expect(SEMANTIC_THRESHOLDS.duplicate).toBe(0.92);
  });

  it("collapses three mutual neighbours onto the earliest posting", () => {
    const map = nearDuplicates([
      { id: "b", vector: at(0), postedAt: 200 },
      { id: "a", vector: at(1), postedAt: 100 },
      { id: "c", vector: at(2), postedAt: 300 },
    ]);
    expect(map.get("a")).toBe("a");
    expect(map.get("b")).toBe("a");
    expect(map.get("c")).toBe("a");
  });

  it("leaves a non-neighbour mapped to itself", () => {
    const map = nearDuplicates([
      { id: "x", vector: at(0), postedAt: 1 },
      { id: "y", vector: at(90), postedAt: 0 },
    ]);
    expect(map.get("x")).toBe("x");
    expect(map.get("y")).toBe("y");
  });

  it("groups transitively: A-B and B-C above threshold keep A-C out of range but group all three", () => {
    // cos(A,B)=cos(B,C)=cos(15deg)=0.966 >= 0.92, while cos(A,C)=cos(30deg)=0.866 < 0.92.
    const items = [
      { id: "A", vector: at(0), postedAt: 1 },
      { id: "B", vector: at(15), postedAt: 2 },
      { id: "C", vector: at(30), postedAt: 3 },
    ];
    expect(SEMANTIC_THRESHOLDS.duplicate).toBeGreaterThan(Math.cos((30 * Math.PI) / 180));
    const map = nearDuplicates(items);
    expect(map.get("A")).toBe("A");
    expect(map.get("B")).toBe("A");
    expect(map.get("C")).toBe("A");
  });

  it("breaks postedAt ties by the lexicographically smaller id", () => {
    const map = nearDuplicates([
      { id: "doc-b", vector: at(0), postedAt: 500 },
      { id: "doc-a", vector: at(0), postedAt: 500 },
    ]);
    expect(map.get("doc-a")).toBe("doc-a");
    expect(map.get("doc-b")).toBe("doc-a");
  });

  it("prefers a dated posting over an undated one", () => {
    const map = nearDuplicates([
      { id: "a", vector: at(0), postedAt: null },
      { id: "z", vector: at(0), postedAt: 5 },
    ]);
    expect(map.get("a")).toBe("z");
    expect(map.get("z")).toBe("z");
  });

  it("does not compare vectors of different lengths and never throws", () => {
    const map = nearDuplicates([
      { id: "p", vector: [1, 0], postedAt: 1 },
      { id: "q", vector: [1, 0, 0], postedAt: 2 },
    ]);
    expect(map.get("p")).toBe("p");
    expect(map.get("q")).toBe("q");
  });
});

describe("olderNeighbours", () => {
  it("returns only older, other, above-threshold neighbours in the same workspace", async () => {
    state.vectorize = createFakeVectorize().binding;
    await upsertVectors(WS, [
      { id: "self", values: [1, 0, 0], kind: "doc", postedAt: 100 },
      { id: "older", values: [1, 0.05, 0], kind: "doc", postedAt: 50 },
      { id: "newer", values: [1, 0.05, 0], kind: "doc", postedAt: 200 },
      { id: "far", values: [0, 1, 0], kind: "doc", postedAt: 10 },
    ]);
    await upsertVectors("ws-b", [{ id: "elsewhere", values: [1, 0.05, 0], kind: "doc", postedAt: 20 }]);

    await expect(
      olderNeighbours(WS, { id: "self", vector: [1, 0, 0] }, { before: 150 }),
    ).resolves.toEqual(["older"]);
  });

  it("returns [] when the Vectorize binding is absent", async () => {
    state.vectorize = null;
    await expect(
      olderNeighbours(WS, { id: "self", vector: [1, 0, 0] }, { before: 150 }),
    ).resolves.toEqual([]);
  });
});
