import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const state = vi.hoisted(() => ({ off: new Map<string, unknown>() }));
vi.mock("@/lib/sources/switch", () => ({ listOffSwitches: async () => state.off }));

import { eligibleSourceCondition, scanOrder } from "@/lib/cron/scan";

const dialect = new PgDialect();
const render = (options?: { includeKeyed?: boolean }) => dialect.sqlToQuery(eligibleSourceCondition("ws-1", options)!);

beforeEach(() => { state.off = new Map(); });

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

it("orders by poll time when no source type is switched off", async () => {
  const { sql: text } = dialect.sqlToQuery(sql.join(await scanOrder(), sql`, `));
  expect(text).toBe('"source"."last_polled_at" asc nulls first, "source"."id"');
});

it("puts switched-off source types last so they cannot starve enabled sources", async () => {
  // browser_run is a switch key but not a source type; comparing it to the enum would fail in Postgres.
  state.off = new Map([["reddit", {}], ["browser_run", {}], ["hn", {}]]);
  const { sql: text, params } = dialect.sqlToQuery(sql.join(await scanOrder(), sql`, `));
  expect(text).toBe('case when "source"."type" in ($1, $2) then 1 else 0 end, "source"."last_polled_at" asc nulls first, "source"."id"');
  expect(params).toEqual(["reddit", "hn"]);
});
