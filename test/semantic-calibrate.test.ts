import { describe, expect, it } from "vitest";

import { largestDisagreements, summarizeShadow } from "@/scripts/semantic-calibrate";

// Hand-built semantic_shadow rows. Fits (non-null): 0.8, 0.6, 0.2, 0.4, 0.9, 0.5.
const rows = [
  { title: "agree high", keywordRung: 2, semanticRung: 2, semanticFit: 0.8, anchorSimilarity: 0.7 },
  { title: "semantic higher", keywordRung: 1, semanticRung: 3, semanticFit: 0.6, anchorSimilarity: 0.9 },
  { title: "semantic lower", keywordRung: 3, semanticRung: 1, semanticFit: 0.2, anchorSimilarity: 0.65 },
  { title: "no rung, fit kept", keywordRung: 0, semanticRung: null, semanticFit: 0.4, anchorSimilarity: 0.3 },
  { title: "agree top", keywordRung: 4, semanticRung: 4, semanticFit: 0.9, anchorSimilarity: 0.95 },
  { title: "no signal", keywordRung: 0, semanticRung: null, semanticFit: null, anchorSimilarity: null },
  { title: "agree threshold", keywordRung: 1, semanticRung: 1, semanticFit: 0.5, anchorSimilarity: 0.6 },
];

describe("summarizeShadow", () => {
  it("counts agreement, direction and missing semantic rungs exactly", () => {
    const summary = summarizeShadow(rows);
    expect(summary).toEqual({
      total: 7,
      agree: 3,
      semanticHigher: 1,
      semanticLower: 1,
      noSemantic: 2,
      fitP50: 0.5,
      fitP90: 0.9,
    });
  });

  it("uses nearest-rank percentiles over non-null fits only", () => {
    // Sorted fits [0.2, 0.4, 0.5, 0.6, 0.8, 0.9], n = 6.
    // P50: rank ceil(3) = 3 -> 0.5. P90: rank ceil(5.4) = 6 -> 0.9 (no interpolation).
    const summary = summarizeShadow(rows);
    expect(summary.fitP50).toBe(0.5);
    expect(summary.fitP90).toBe(0.9);
  });

  it("returns zeros for an empty table", () => {
    expect(summarizeShadow([])).toEqual({
      total: 0,
      agree: 0,
      semanticHigher: 0,
      semanticLower: 0,
      noSemantic: 0,
      fitP50: 0,
      fitP90: 0,
    });
  });

  it("uses fit 0 percentiles when every fit is null", () => {
    const summary = summarizeShadow([
      { keywordRung: 2, semanticRung: null, semanticFit: null, anchorSimilarity: null },
    ]);
    expect(summary.fitP50).toBe(0);
    expect(summary.fitP90).toBe(0);
    expect(summary.noSemantic).toBe(1);
  });

  it("takes the nearest rank for ten values", () => {
    // Fits 0.1..1.0: P50 rank 5 -> 0.5, P90 rank 9 -> 0.9.
    const fits = [0.7, 0.1, 1.0, 0.3, 0.9, 0.5, 0.2, 0.8, 0.4, 0.6];
    const summary = summarizeShadow(
      fits.map((fit) => ({ keywordRung: 0, semanticRung: 0, semanticFit: fit, anchorSimilarity: null })),
    );
    expect(summary.fitP50).toBe(0.5);
    expect(summary.fitP90).toBe(0.9);
  });
});

describe("largestDisagreements", () => {
  it("orders by rung gap, ignores agreement and missing rungs, and caps the list", () => {
    const top = largestDisagreements(rows, 20);
    expect(top.map((row) => row.title)).toEqual(["semantic higher", "semantic lower"]);
  });

  it("sorts larger gaps first and honours the limit", () => {
    const sample = [
      { title: "gap 1", keywordRung: 1, semanticRung: 2, semanticFit: 0.1, anchorSimilarity: 0.6 },
      { title: "gap 4", keywordRung: 0, semanticRung: 4, semanticFit: 0.1, anchorSimilarity: 0.6 },
      { title: "gap 2", keywordRung: 4, semanticRung: 2, semanticFit: 0.1, anchorSimilarity: 0.6 },
    ];
    expect(largestDisagreements(sample, 2).map((row) => row.title)).toEqual(["gap 4", "gap 2"]);
  });
});
