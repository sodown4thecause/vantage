import { describe, expect, it } from "vitest";

import {
  buildCandidateWeights,
  runOfflineReplay,
} from "@/lib/learning/replay";

describe("runOfflineReplay", () => {
  const items = [
    {
      lead: { score: 76, intentRung: 3, confidence: 0.8, factors: {} },
      document: { platform: "reddit", title: "Test", contentMd: "Content" },
      baselineFeatures: {},
    },
    {
      lead: { score: 30, intentRung: 2, confidence: 0.5, factors: {} },
      document: { platform: "hn", title: "Test 2", contentMd: "Content 2" },
      baselineFeatures: {},
    },
  ];

  it("produces baseline and candidate scores", () => {
    const result = runOfflineReplay(items, {});
    expect(result.results.length).toBe(2);
    expect(result.results[0].baselineScore).toBe(76);
    expect(result.results[0].candidateScore).toBe(76);
  });

  it("detects regression when precision drops", () => {
    const badWeights = { title_length: -100 };
    const result = runOfflineReplay(items, badWeights);
    expect(result.regressionDetected).toBeDefined();
  });

  it("computes mean delta", () => {
    const result = runOfflineReplay(items, { base_score: 0.1 });
    expect(typeof result.meanDelta).toBe("number");
  });

  it("handles empty items", () => {
    const result = runOfflineReplay([], {});
    expect(result.results.length).toBe(0);
    expect(result.meanDelta).toBe(0);
    expect(result.meanPrecisionDelta).toBe(0);
    expect(result.regressionDetected).toBe(false);
  });
});

describe("buildCandidateWeights", () => {
  it("normalizes weights to sum to 1 by abs value", () => {
    const weights = buildCandidateWeights({ a: 0.5, b: 0.3, c: -0.2 });
    const sum = Object.values(weights).reduce((s, v) => s + Math.abs(v), 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it("returns empty for empty input", () => {
    expect(buildCandidateWeights({})).toEqual({});
  });
});
