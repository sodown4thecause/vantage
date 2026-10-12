import { expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { eligibleSourceCondition } from "@/lib/cron/scan";

const render = (options?: { includeKeyed?: boolean }) => new PgDialect().sqlToQuery(eligibleSourceCondition("ws-1", options)!);

it("keeps scheduled scans on free public sources only", () => {
  const { sql, params } = render();
  expect(sql).toContain('"source"."workspace_id" = $1');
  expect(params).toContain("free");
  expect(params).not.toContain("byok");
  expect(params).not.toContain("reddit");
  expect(params).not.toContain("web_search");
});

it("adds keyed Reddit and forum/blog searches to an owner's manual scan, still scoped to the workspace", () => {
  const { sql, params } = render({ includeKeyed: true });
  expect(sql).toContain('"source"."workspace_id" = $1');
  expect(params[0]).toBe("ws-1");
  expect(params).toEqual(expect.arrayContaining(["free", "byok", "reddit", "web_search", "paused"]));
  expect(params).not.toContain("paid");
});
