import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { sourceTypeEnum, workspace } from "../lib/db/schema";
import { opportunityOutcomeTypeEnum } from "../lib/db/schema";
import { opportunityOutcome } from "../lib/db/schema";
import { workspaceLearningWeights } from "../lib/db/schema";

describe("M1 database contract", () => {
  it("accepts every M1 collector source type", () => {
    expect(sourceTypeEnum.enumValues).toEqual(
      expect.arrayContaining([
        "hn",
        "rss",
        "substack",
        "producthunt",
        "youtube",
        "reddit",
        "x",
      ]),
    );
  });

  it("stores Neon Auth user ids as text", () => {
    expect(getTableColumns(workspace).ownerUserId.getSQLType()).toBe("text");
  });
});

describe("Learning scaffold schema contract", () => {
  it("has opportunity_outcome_type enum", () => {
    expect(opportunityOutcomeTypeEnum.enumValues).toEqual(
      expect.arrayContaining(["useful", "not_useful", "acted_on"]),
    );
  });

  it("opportunity_outcome has workspace-scoped foreign key", () => {
    const cols = getTableColumns(opportunityOutcome);
    expect(cols.workspace_id.getSQLType()).toBe("uuid");
    expect(cols.lead_id.getSQLType()).toBe("uuid");
    expect(cols.outcome_type.getSQLType()).toContain("enum");
  });

  it("workspace_learning_weights has versioned JSON weights", () => {
    const cols = getTableColumns(workspaceLearningWeights);
    expect(cols.weights.getSQLType()).toContain("jsonb");
    expect(cols.version.getSQLType()).toBe("integer");
    expect(cols.active.getSQLType()).toBe("boolean");
  });
});
