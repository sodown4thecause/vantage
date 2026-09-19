import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { sourceTypeEnum, workspace } from "../lib/db/schema";

describe("M1 database contract", () => {
  it("accepts every M1 collector source type", () => {
    expect(sourceTypeEnum.enumValues).toEqual(
      expect.arrayContaining(["hn", "rss", "substack", "producthunt", "youtube"]),
    );
  });

  it("stores Neon Auth user ids as text", () => {
    expect(getTableColumns(workspace).ownerUserId.getSQLType()).toBe("text");
  });
});
