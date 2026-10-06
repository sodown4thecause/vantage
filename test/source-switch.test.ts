import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";

import { decideSwitch } from "@/lib/sources/switch";
import { costEvent, sharedPost, sourceSwitch } from "@/lib/db/schema";

describe("decideSwitch", () => {
  it("treats a missing row as on", () => {
    expect(decideSwitch(undefined)).toEqual({ enabled: true, state: "on", reason: "" });
    expect(decideSwitch(null).enabled).toBe(true);
  });

  it("runs only when the state is on", () => {
    expect(decideSwitch({ state: "on", reason: "" }).enabled).toBe(true);
    expect(decideSwitch({ state: "paused", reason: "Reddit paused" })).toEqual({
      enabled: false,
      state: "paused",
      reason: "Reddit paused",
    });
    expect(decideSwitch({ state: "blocked", reason: "" })).toMatchObject({
      enabled: false,
      reason: "blocked by operator",
    });
  });
});

describe("Phase 1 schema contract", () => {
  it("keys switches by source key and defaults them on", () => {
    const cols = getTableColumns(sourceSwitch);
    expect(cols.sourceKey.primary).toBe(true);
    expect(cols.state.default).toBe("on");
  });

  it("keeps the cost ledger workspace link nullable so platform costs fit", () => {
    expect(getTableColumns(costEvent).workspaceId.notNull).toBe(false);
  });

  it("has no workspace column on shared posts", () => {
    expect(Object.keys(getTableColumns(sharedPost))).not.toContain("workspaceId");
  });
});
