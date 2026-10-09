import { describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/client";
import { opportunityOutcome, workspaceLearningWeights } from "@/lib/db/schema";
import { applyLearningWeights, getActiveWeights } from "@/lib/opportunities/features";
import { scoreFeatures } from "@/lib/opportunities/features";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

const mockWorkspaceId = "00000000-0000-0000-0000-000000000000";
const baselineLead = {
  id: "lead-1",
  workspaceId: mockWorkspaceId,
  documentId: "doc-1",
  intentRung: 3,
  confidence: 0.8,
  score: 76,
  factors: { matched: ["tool comparison"] },
  status: "reviewing",
};

const baselineDoc = {
  platform: "reddit",
  title: "Test",
  contentMd: "Content",
};

function makeDb(withWeights?: { weights: Record<string, number>; version: number }) {
  const rows = withWeights ? [{ ...withWeights, workspaceId: mockWorkspaceId, active: true, id: "w-1" }] : [];
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            then: async (fn: (rows: unknown[]) => unknown) => {
              const result = rows as unknown[];
              return result;
            },
          })),
        })),
      })),
    })),
  };
}

describe("applyLearningWeights — regression when flag off", () => {
  it("returns base score unchanged when LEARNING_ENABLED is not set", async () => {
    vi.stubEnv("LEARNING_ENABLED", "false");
    try {
      const result = await applyLearningWeights(
        baselineLead.score,
        scoreFeatures(baselineLead, baselineDoc),
        mockWorkspaceId,
      );
      expect(result.applied).toBe(false);
      expect(result.score).toBe(baselineLead.score);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("applyLearningWeights — no active weights", () => {
  it("returns base score when no weights exist", async () => {
    vi.stubEnv("LEARNING_ENABLED", "true");
    const db = makeDb();
    vi.spyOn(import("@/lib/db/client"), "getDb").mockReturnValue(db as ReturnType<typeof getDb>);
    try {
      const result = await applyLearningWeights(
        baselineLead.score,
        scoreFeatures(baselineLead, baselineDoc),
        mockWorkspaceId,
      );
      expect(result.applied).toBe(false);
      expect(result.score).toBe(baselineLead.score);
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });
});

describe("getActiveWeights", () => {
  it("returns null when no active weights exist", async () => {
    const db = makeDb();
    vi.spyOn(import("@/lib/db/client"), "getDb").mockReturnValue(db as ReturnType<typeof getDb>);
    try {
      const result = await getActiveWeights(mockWorkspaceId);
      expect(result).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("Regression: with flag off, scores match baseline", () => {
  it("adjustedScore equals baseScore when learning disabled", async () => {
    vi.stubEnv("LEARNING_ENABLED", "false");
    try {
      const { scoreOpportunity } = await import("@/lib/opportunities/features");
      const result = await scoreOpportunity(baselineLead, baselineDoc, mockWorkspaceId);
      expect(result.learningApplied).toBe(false);
      expect(result.adjustedScore).toBe(result.baseScore);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
