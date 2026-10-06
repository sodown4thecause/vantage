import { describe, expect, it } from "vitest";

import {
  clusterKeyForDocuments,
  computeFeatures,
  decideStatus,
  scoreFeatures,
} from "../lib/opportunities/features";
import type { NormalizedDocument } from "../lib/pipeline/normalize";

function doc(
  partial: Partial<NormalizedDocument> & Pick<NormalizedDocument, "id" | "text">,
): NormalizedDocument {
  return {
    workspaceId: "ws-1",
    urlCanonical: `https://example.com/${partial.id}`,
    platform: "reddit",
    title: partial.title ?? "tool recommendation",
    authorRef: null,
    postedAt: new Date("2026-09-20T12:00:00.000Z"),
    contentHash: partial.id,
    ...partial,
  };
}

describe("opportunity features and ranking", () => {
  it("does not treat URL fragments as product relevance", () => {
    const features = computeFeatures([doc({ id: "urls", text: "Looking to buy an alternative at https://example.com" })], {
      productDescription: "Invoice accounting", topics: ["invoice accounting"], competitors: ["https://bookkeeping.com"],
    });
    expect(features.fit).toBe(0);
    expect(decideStatus(features)).toBe("ignore");
  });
  it("scores relevance against the owning product rather than buying words", () => {
    const docs = [doc({ id: "agent", title: "Looking for agent evaluation", text: "Need reliable agent evaluation benchmarks. What should I buy?" })];
    const relevant = { productDescription: "Agent evaluation benchmarks", targetCustomer: "Teams", topics: ["agent evaluation"], competitors: [] };
    const unrelated = { ...relevant, productDescription: "Invoice accounting", topics: ["invoice accounting"] };
    expect(computeFeatures(docs, relevant).fit).toBeGreaterThan(0.5);
    expect(computeFeatures(docs, unrelated).fit).toBe(0);
    expect(decideStatus(computeFeatures(docs, unrelated))).toBe("ignore");
  });
  it("clusters related documents under a shared key", () => {
    const docs = [
      doc({
        id: "1",
        title: "Looking for a social listening tool",
        text: "Need a social listening tool for brand monitoring on reddit",
      }),
      doc({
        id: "2",
        title: "Social listening recommendations?",
        text: "Anyone recommend a social listening tool for monitoring mentions",
      }),
    ];
    const key = clusterKeyForDocuments(docs);
    expect(key.startsWith("reddit:")).toBe(true);
    expect(key).toMatch(/social|listening|tool|monitoring|recommend/);
  });

  it("scores ten related high-intent items as opportunity or review", () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      doc({
        id: `d${i}`,
        title: `Looking for a tool recommendation ${i}`,
        text: "Looking for a tool to buy for social listening and brand monitoring. Any recommend?",
        postedAt: new Date(Date.now() - i * 3600_000),
      }),
    );
    const features = computeFeatures(docs, { productDescription: "Social listening and brand monitoring", topics: ["social listening"], competitors: [] });
    expect(features.evidence).toBeGreaterThan(0.4);
    expect(features.intent).toBeGreaterThan(0.5);
    const status = decideStatus(features);
    expect(["opportunity", "review", "monitor"]).toContain(status);
    expect(scoreFeatures(features)).toBeGreaterThan(0.4);
  });

  it("routes low-confidence weak signals to review or ignore", () => {
    const docs = [
      doc({
        id: "weak",
        title: "hello world",
        text: "random chatter without buying signals",
      }),
    ];
    const features = computeFeatures(docs, { productDescription: "Random chatter", topics: ["chatter"], competitors: [] });
    expect(features.lowConfidence).toBe(true);
    expect(decideStatus(features)).toBe("review");
  });

  it("exposes inspectable deterministic feature fields", () => {
    const features = computeFeatures([
      doc({
        id: "a",
        text: "What should I use instead — looking for an alternative tool to buy",
      }),
    ]);
    for (const key of [
      "fit",
      "intent",
      "evidence",
      "momentum",
      "timing",
      "modelConfidence",
    ] as const) {
      expect(typeof features[key]).toBe("number");
      expect(features[key]).toBeGreaterThanOrEqual(0);
      expect(features[key]).toBeLessThanOrEqual(1);
    }
  });
});
