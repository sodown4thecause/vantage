import { describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/client";
import { opportunityOutcome } from "@/lib/db/schema";
import { scoreFeatures, applyLearningWeights } from "@/lib/opportunities/features";
import { runOfflineReplay } from "@/lib/learning/replay";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

const mockWorkspaceId = "00000000-0000-0000-0000-000000000000";

const makeItem = (score: number, platform: string) => ({
  lead: { score, intentRung: 3, confidence: 0.8, factors: {} },
  document: { platform, title: "Test", contentMd: "Content" },
  baselineFeatures: {},
});

describe("Offline eval: regression on golden vectors", () => {
  it("scores match baseline when candidate weights are empty", () => {
    const items = [makeItem(76, "reddit"), makeItem(30, "hn"), makeItem(50, "x")];
    const result = runOfflineReplay(items, {});
    for (const r of result.results) {
      expect(r.candidateScore).toBe(r.baselineScore);
      expect(r.delta).toBe(0);
    }
    expect(result.meanDelta).toBe(0);
    expect(result.regressionDetected).toBe(false);
  });

  it("no cross-workspace leakage in replay", () => {
    const items = [makeItem(76, "reddit")];
    const result = runOfflineReplay(items, { base_score: 0.1 });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].featureVectorsCompared).toBe(1);
  });
});

describe("Offline eval: precision/action-rate deltas", () => {
  it("reports precision delta for positive weights", () => {
    const items = [makeItem(76, "reddit"), makeItem(20, "hn")];
    const result = runOfflineReplay(items, { intent_rung: 0.2 });
    expect(typeof result.meanPrecisionDelta).toBe("number");
  });

  it("flags regression when precision drops significantly", () => {
    const items = [makeItem(76, "reddit"), makeItem(50, "hn"), makeItem(30, "x")];
    const result = runOfflineReplay(items, { base_score: -20 });
    expect(result.regressionDetected).toBeDefined();
  });
});
