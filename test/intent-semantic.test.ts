import { describe, expect, it } from "vitest";

import { computeFeatures } from "../lib/opportunities/features";
import { classifyIntent } from "../lib/pipeline/intent-ladder";
import type { NormalizedDocument } from "../lib/pipeline/normalize";
import type { SemanticSignal } from "../lib/pipeline/semantic";

function doc(
  partial: Pick<NormalizedDocument, "id" | "text"> & Partial<NormalizedDocument>,
): NormalizedDocument {
  return {
    workspaceId: "ws-1",
    urlCanonical: `https://example.com/${partial.id}`,
    platform: "reddit",
    title: "",
    authorRef: null,
    postedAt: new Date("2026-09-20T12:00:00.000Z"),
    contentHash: partial.id,
    ...partial,
  };
}

function signal(partial: Partial<SemanticSignal> & Pick<SemanticSignal, "documentId">): SemanticSignal {
  return { fit: 0, rung: null, anchorSimilarity: null, ...partial };
}

// Snapshot of classifyIntent(doc) with no semantic signal, captured before the
// semantic blend was added. Key order matters: the check compares serialised JSON.
const FIXTURES: NormalizedDocument[] = [
  doc({ id: "f1", platform: "reddit", title: "Tool search", text: "Anyone know a tool for social listening?" }),
  doc({ id: "f2", platform: "hn", title: "How do I start", text: "How do I track mentions of my brand online?" }),
  doc({ id: "f3", platform: "rss", title: "Launch week", text: "Thoughts on Product Hunt launches this week" }),
  doc({ id: "f4", platform: "reddit", title: "Pricing", text: "Looking to buy a monitoring tool, what's the pricing?" }),
  doc({ id: "f5", platform: "hn", title: "Lunch", text: "Random lunch photo from today" }),
  doc({ id: "f6", platform: "reddit", title: "Stack", text: "What should I use for brand monitoring? Recommend something." }),
];

const SNAPSHOT = [
  {
    documentId: "f1",
    intentRung: 3,
    confidence: 0.75,
    score: 75,
    reason: "looking for a tool/solution",
    factors: { matched: ["looking for a tool/solution", "category awareness"], platform: "reddit" },
  },
  {
    documentId: "f2",
    intentRung: 2,
    confidence: 0.6,
    score: 52,
    reason: "research / how-to",
    factors: { matched: ["research / how-to"], platform: "hn" },
  },
  {
    documentId: "f3",
    intentRung: 1,
    confidence: 0.4,
    score: 28,
    reason: "category awareness",
    factors: { matched: ["category awareness"], platform: "rss" },
  },
  {
    documentId: "f4",
    intentRung: 4,
    confidence: 0.95,
    score: 99,
    reason: "explicit buy / purchase intent",
    factors: { matched: ["explicit buy / purchase intent"], platform: "reddit" },
  },
  {
    documentId: "f5",
    intentRung: 0,
    confidence: 0.15,
    score: 3,
    reason: "no intent signals",
    factors: { platform: "hn" },
  },
  {
    documentId: "f6",
    intentRung: 4,
    confidence: 0.9,
    score: 98,
    reason: "recommendation request",
    factors: { matched: ["recommendation request", "category awareness"], platform: "reddit" },
  },
];

describe("classifyIntent with semantic signals", () => {
  it("keeps the no-signal output byte-identical for the six fixtures", () => {
    const results = FIXTURES.map((d) => classifyIntent(d));
    expect(JSON.stringify(results)).toBe(JSON.stringify(SNAPSHOT));
  });

  it("treats a null or omitted signal as no signal", () => {
    for (const d of FIXTURES) {
      expect(JSON.stringify(classifyIntent(d, null))).toBe(JSON.stringify(classifyIntent(d)));
    }
  });

  it("lifts a document with no keyword match to the semantic rung", () => {
    const d = doc({ id: "sem", text: "anything that beats Mention for our launches?" });
    expect(classifyIntent(d).intentRung).toBe(0);

    const result = classifyIntent(d, signal({ documentId: "sem", rung: 3, anchorSimilarity: 0.82 }));
    expect(result.intentRung).toBe(3);
    expect(result.reason).toBe("semantic match to comparison");
    expect(result.confidence).toBe(0.82);
    expect(result.factors.semantic).toEqual({ rung: 3, anchorSimilarity: 0.82, fit: 0 });
  });

  it("caps semantic confidence at 0.95", () => {
    const d = doc({ id: "cap", text: "anything that beats Mention for our launches?" });
    const result = classifyIntent(d, signal({ documentId: "cap", rung: 4, anchorSimilarity: 0.99 }));
    expect(result.intentRung).toBe(4);
    expect(result.confidence).toBe(0.95);
    expect(result.reason).toBe("semantic match to purchase/recommend");
  });

  it("never lowers a keyword rung 4 with a rung 2 semantic signal", () => {
    const d = doc({ id: "kw", text: "Looking to buy a monitoring tool, what's the pricing?" });
    const before = classifyIntent(d);
    const result = classifyIntent(d, signal({ documentId: "kw", rung: 2, anchorSimilarity: 0.7 }));
    expect(result.intentRung).toBe(4);
    expect(result.confidence).toBe(before.confidence);
    expect(result.reason).toBe(before.reason);
  });

  it("keeps the keyword result when the semantic rung is null", () => {
    const d = doc({ id: "low", text: "Random lunch photo from today" });
    const before = classifyIntent(d);
    const result = classifyIntent(d, signal({ documentId: "low", rung: null, anchorSimilarity: 0.4, fit: 0.3 }));
    expect(result.intentRung).toBe(before.intentRung);
    expect(result.confidence).toBe(before.confidence);
    expect(result.reason).toBe(before.reason);
    expect(result.factors.semantic).toEqual({ rung: null, anchorSimilarity: 0.4, fit: 0.3 });
  });
});

describe("computeFeatures with semantic signals", () => {
  const profile = {
    productDescription: "Invoice accounting",
    topics: ["invoice accounting"],
    competitors: [],
  };

  it("uses the semantic fit when it exceeds token fit", () => {
    const docs = [doc({ id: "fit", text: "Anyone found a good ledger for freelancers?" })];
    expect(computeFeatures(docs, profile).fit).toBe(0);

    const semantic = new Map([["fit", signal({ documentId: "fit", fit: 0.8 })]]);
    expect(computeFeatures(docs, profile, semantic).fit).toBe(0.8);
  });

  it("keeps token fit when it exceeds semantic fit", () => {
    const docs = [doc({ id: "tok", text: "Invoice accounting software for small teams" })];
    const token = computeFeatures(docs, profile).fit;
    expect(token).toBeGreaterThan(0.3);

    const semantic = new Map([["tok", signal({ documentId: "tok", fit: 0.3 })]]);
    expect(computeFeatures(docs, profile, semantic).fit).toBe(token);
  });

  it("uses the best semantic fit across the cluster", () => {
    const docs = [
      doc({ id: "a", text: "Anyone found a good ledger?" }),
      doc({ id: "b", text: "Need a better bookkeeping option" }),
    ];
    const semantic = new Map([
      ["a", signal({ documentId: "a", fit: 0.2 })],
      ["b", signal({ documentId: "b", fit: 0.65 })],
    ]);
    expect(computeFeatures(docs, profile, semantic).fit).toBe(0.65);
  });

  it("blends a semantic rung into the intent feature", () => {
    const docs = [doc({ id: "int", text: "anything that beats Mention for our launches?" })];
    expect(computeFeatures(docs, profile).intent).toBe(0);

    const semantic = new Map([["int", signal({ documentId: "int", rung: 4, anchorSimilarity: 0.9 })]]);
    expect(computeFeatures(docs, profile, semantic).intent).toBe(1);
  });

  it("is unchanged when the semantic map is null", () => {
    const docs = FIXTURES;
    expect(JSON.stringify(computeFeatures(docs, profile, null))).toBe(JSON.stringify(computeFeatures(docs, profile)));
  });
});
