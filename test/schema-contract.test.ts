import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  opportunityOutcome,
  outcomeTypeEnum,
  sourceTypeEnum,
  workspace,
} from "../lib/db/schema";

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

describe("opportunity outcome contract", () => {
  it("offers exactly the three outcome categories", () => {
    expect(outcomeTypeEnum.enumValues).toEqual([
      "useful",
      "not_useful",
      "acted_on",
    ]);
  });

  it("scopes outcomes to workspace and lead", () => {
    const columns = getTableColumns(opportunityOutcome);
    expect(columns.workspaceId.getSQLType()).toBe("uuid");
    expect(columns.leadId.getSQLType()).toBe("uuid");
    expect(columns.outcomeType.getSQLType()).toContain("outcome_type");
  });
});
