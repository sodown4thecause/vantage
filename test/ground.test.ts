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

import { chunkText, indexMaterial, rankEvidence, selectGrounding } from "@/lib/drafting/ground";
import { upsertVectors } from "@/lib/embeddings/store";
import { createFakeAi, fakeVector } from "./helpers/fake-ai";
import { createFakeVectorize } from "./helpers/fake-vectorize";

const WORKSPACE = "ws-1";
const PROFILE = "profile-1";

function longText(): string {
  const sentences: string[] = [];
  for (let i = 0; sentences.join(" ").length < 3000; i++) {
    sentences.push(`Sentence number ${i} describes one concrete product capability for analysts.`);
  }
  return sentences.join(" ");
}

function materialText(): string {
  const paragraph = (topic: string) => `${topic} `.repeat(60).trim();
  return [
    paragraph("Vantage watches Reddit threads for founders comparing analytics tools."),
    paragraph("Our billing page explains plan limits and how seats are counted for teams."),
    paragraph("The API exports every scored opportunity as JSON for internal dashboards."),
  ].join("\n\n");
}

beforeEach(() => {
  state.ai = null;
  state.vectorize = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("chunkText", () => {
  it("keeps chunks within 1200 characters, drops blanks, and overlaps neighbours by up to 150 characters", () => {
    const chunks = chunkText(longText());
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.length).toBeLessThanOrEqual(1200);
    }
    for (let i = 0; i + 1 < chunks.length; i++) {
      const tail = chunks[i]!.slice(-150);
      const carried = tail.slice(tail.indexOf(" ") + 1);
      expect(chunks[i + 1]!.startsWith(carried)).toBe(true);
    }
  });

  it("returns no chunks for blank text", () => {
    expect(chunkText("  \n\n  ")).toEqual([]);
  });
});

describe("selectGrounding", () => {
  it("returns the chunk whose vector is closest to the thread vector", async () => {
    const ai = createFakeAi();
    const vz = createFakeVectorize();
    state.ai = ai.binding;
    state.vectorize = vz.binding;

    const chunks = chunkText(materialText());
    expect(await indexMaterial(WORKSPACE, PROFILE, materialText())).toBe(chunks.length);

    const picked = await selectGrounding(WORKSPACE, materialText(), PROFILE, chunks[1]!, 1);
    expect(picked).toEqual([chunks[1]]);
  });

  it("ignores vector ids whose index is out of range for the current material", async () => {
    const ai = createFakeAi();
    const vz = createFakeVectorize();
    state.ai = ai.binding;
    state.vectorize = vz.binding;

    const chunks = chunkText(materialText());
    await indexMaterial(WORKSPACE, PROFILE, materialText());
    await upsertVectors(WORKSPACE, [
      { id: `material:${PROFILE}:99`, values: fakeVector(chunks[0]!), kind: "material" },
    ]);

    const picked = await selectGrounding(WORKSPACE, materialText(), PROFILE, chunks[0]!, 4);
    expect(picked).not.toBeNull();
    expect(picked!.every((text) => chunks.includes(text))).toBe(true);
  });

  it("returns null with no AI or Vectorize bindings", async () => {
    expect(await selectGrounding(WORKSPACE, materialText(), PROFILE, "thread about analytics")).toBeNull();
  });

  it("returns null when there is no material or no thread text", async () => {
    const ai = createFakeAi();
    state.ai = ai.binding;
    state.vectorize = createFakeVectorize().binding;
    expect(await selectGrounding(WORKSPACE, "", PROFILE, "thread")).toBeNull();
    expect(await selectGrounding(WORKSPACE, materialText(), PROFILE, "   ")).toBeNull();
  });
});

describe("indexMaterial", () => {
  it("returns 0 and writes nothing when no binding is available", async () => {
    expect(await indexMaterial(WORKSPACE, PROFILE, materialText())).toBe(0);
  });

  it("deletes stale tail ids after a shorter material text is indexed", async () => {
    const ai = createFakeAi();
    const vz = createFakeVectorize();
    state.ai = ai.binding;
    state.vectorize = vz.binding;

    await indexMaterial(WORKSPACE, PROFILE, longText());
    expect(await indexMaterial(WORKSPACE, PROFILE, "Short product note.")).toBe(1);

    const deleted = vz.calls.flatMap((call) => (call.op === "deleteByIds" ? call.ids : []));
    expect(deleted).toContain(`material:${PROFILE}:1`);
    expect(deleted).not.toContain(`material:${PROFILE}:0`);
  });
});

describe("rankEvidence", () => {
  it("orders evidence by similarity of stored document vectors to the thread vector", async () => {
    const vz = createFakeVectorize();
    state.ai = createFakeAi().binding;
    state.vectorize = vz.binding;
    await upsertVectors(WORKSPACE, [
      { id: "doc:a", values: fakeVector("alpha thread"), kind: "doc" },
      { id: "doc:b", values: fakeVector("beta thread"), kind: "doc" },
    ]);
    const evidence = [{ documentId: "a" }, { documentId: "b" }, { documentId: "c" }];

    const ranked = await rankEvidence(WORKSPACE, fakeVector("beta thread"), evidence, 2);
    expect(ranked.map((item) => item.documentId)).toEqual(["b", "a"]);
  });

  it("keeps the original order when no thread vector is available", async () => {
    const evidence = [{ documentId: "a" }, { documentId: "b" }, { documentId: "c" }];
    expect(await rankEvidence(WORKSPACE, null, evidence, 2)).toEqual(evidence.slice(0, 2));
  });
});
