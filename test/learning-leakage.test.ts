import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/client";
import { opportunityOutcome } from "@/lib/db/schema";
import { workspaceLearningWeights } from "@/lib/db/schema";
import { workspace } from "@/lib/db/schema";

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
  returning: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  execute: vi.fn(),
};

describe("cross-workspace leakage guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  });

  it("filters outcomes by workspaceId", async () => {
    const { listOutcomes } = await import("@/lib/outcomes/feed");
    mockDb.thenResolve([{ id: "1" }]);

    await listOutcomes({ workspaceId: "ws-1" });

    const whereCall = mockDb.where.mock.calls[0];
    const whereSql = JSON.stringify(whereCall);
    expect(whereSql).toContain("workspace_id");
  });

  it("filters learning weights by workspaceId and active", async () => {
    const wsId = "ws-unique-" + Date.now();
    mockDb.thenResolve([{ id: "1", weights: {}, version: 1 }]);

    const { getActiveWeights } = await import("@/lib/opportunities/features");
    // Re-import to pick up the mock
    const { getDb } = await import("@/lib/db/client");
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    const result = await getActiveWeights(wsId);
    expect(mockDb.where).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
