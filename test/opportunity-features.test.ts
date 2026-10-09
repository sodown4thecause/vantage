import { describe, expect, it } from "vitest";

import { MIN_EVIDENCE_THRESHOLD, MIN_ACTED_ON_THRESHOLD } from "@/lib/opportunities/features";
import { decideStatus, scoreFeatures } from "@/lib/opportunities/features";

const baselineLead = {
  id: "lead-1",
  workspaceId: "ws-1",
  documentId: "doc-1",
  intentRung: 3,
  confidence: 0.8,
  score: 76,
  factors: { matched: ["tool comparison"] },
  status: "reviewing",
};

const baselineDoc = {
  platform: "reddit",
  title: "Looking for a Reddit monitoring tool",
  contentMd: "We need a tool to track mentions.",
};

describe("scoreFeatures (baseline, no learning)", () => {
  it("derives feature vector from lead + document", () => {
    const features = scoreFeatures(baselineLead, baselineDoc);
    expect(features.intent_rung).toBe(3);
    expect(features.confidence).toBe(0.8);
    expect(features.base_score).toBe(76);
    expect(features.platform).toBe("reddit");
    expect(features.has_title).toBe(1);
    expect(features.has_comparison_signal).toBe(1);
  });

  it("handles missing document gracefully", () => {
    const features = scoreFeatures(baselineLead);
    expect(features.platform).toBe("unknown");
    expect(features.has_title).toBe(0);
  });
});

describe("decideStatus", () => {
  it("preserves terminal statuses", () => {
    expect(decideStatus({ ...baselineLead, status: "approved" })).toBe("approved");
    expect(decideStatus({ ...baselineLead, status: "rejected" })).toBe("rejected");
  });

  it("escalates high intent to queued", () => {
    expect(decideStatus({ ...baselineLead, intentRung: 4, status: "new" })).toBe("queued");
  });

  it("keeps reviewing for mid intent", () => {
    expect(decideStatus({ ...baselineLead, status: "new" })).toBe("reviewing");
  });
});

describe("MIN_EVIDENCE_THRESHOLD", () => {
  it("has sensible evidence threshold constants", () => {
    expect(MIN_EVIDENCE_THRESHOLD).toBeGreaterThanOrEqual(1);
    expect(MIN_ACTED_ON_THRESHOLD).toBeGreaterThanOrEqual(1);
    expect(MIN_EVIDENCE_THRESHOLD).toBeGreaterThanOrEqual(MIN_ACTED_ON_THRESHOLD);
  });

  it("uses plan defaults", () => {
    expect(MIN_EVIDENCE_THRESHOLD).toBe(50);
    expect(MIN_ACTED_ON_THRESHOLD).toBe(10);
  });
});
