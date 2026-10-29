import { describe, expect, it } from "vitest";

import { BACKFILL_USAGE, parseBackfillArgs } from "@/lib/trends/backfill-args";

describe("topic volume backfill arguments", () => {
  it("takes exactly one workspace id", () => {
    expect(parseBackfillArgs(["ws_123"])).toEqual({ workspaceId: "ws_123" });
  });

  it.each([[[]], [["  "]], [["a", "b"]], [["--all-workspaces"]], [["--workspace"]]])("rejects %j with the usage text", (argv) => {
    expect(() => parseBackfillArgs(argv)).toThrow(BACKFILL_USAGE);
  });
});
