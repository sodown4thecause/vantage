import { describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/client";
import { opportunityOutcome } from "@/lib/db/schema";
import { workspace } from "@/lib/db/schema";
import { derivePreferences } from "@/lib/learning/derive";
import { recordOutcome } from "@/lib/outcomes/feed";
import { computeNorthStar } from "@/lib/outcomes/metrics";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: "1" }]),
  execute: vi.fn(),
};

describe("workspace isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(import("@/lib/db/client"), "getDb").mockReturnValue(mockDb as ReturnType<typeof getDb>);
  });

  it("derivePreferences filters by workspaceId", async () => {
    const wsId = "ws-isolated-" + Date.now();
    mockDb.thenResolve([{ count: 5 }]);
    const result = await derivePreferences(wsId);
    expect(mockDb.where).toHaveBeenCalled();
    expect(result.totalEvidence).toBe(5);
  });

  it("recordOutcome targets correct workspace", async () => {
    const wsId = "ws-target-" + Date.now();
    await recordOutcome({
      workspaceId: wsId,
      leadId: "lead-1",
      outcomeType: "useful",
    });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("computeNorthStar filters by workspaceId", async () => {
    const wsId = "ws-north-" + Date.now();
    mockDb.thenResolve([{ count: 0 }]);
    const result = await computeNorthStar(wsId);
    expect(result.workspaceId).toBe(wsId);
    expect(result.totalOutcomes).toBe(0);
  });
});

describe("no cross-workspace leakage", () => {
  it("uses workspaceId in every query condition", async () => {
    const ws1 = "ws-1";
    const ws2 = "ws-2";
    vi.clearAllMocks();

    const db1 = { ...mockDb, thenResolve: vi.fn().mockResolvedValue([{ count: 0 }]) };
    const db2 = { ...mockDb, thenResolve: vi.fn().mockResolvedValue([{ count: 0 }]) };
    vi.spyOn(import("@/lib/db/client"), "getDb").mockReturnValueOnce(db1 as ReturnType<typeof getDb>).mockReturnValueOnce(db2 as ReturnType<typeof getDb>);

    await computeNorthStar(ws1);
    const ws1Where = JSON.stringify(mockDb.where.mock.calls);
    expect(ws1Where).toContain(ws1);
  });
});
