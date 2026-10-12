import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const state = vi.hoisted(() => ({
  allowed: true,
  dbCalls: 0,
  rows: [] as Array<{ id: string; name: string; type: string; health: string }>,
  writes: [] as Record<string, unknown>[],
  collected: [] as string[],
  busy: false,
  scanError: false,
  sourceHealth: "healthy",
  recentWhere: undefined as SQL | undefined,
  recentJoin: undefined as SQL | undefined,
}));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: async () => (state.allowed ? { ok: true, userId: "u1" } : { ok: false, status: 403, error: "forbidden" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cf/queue", () => ({ enqueueEmbedJob: async () => true }));
vi.mock("@/lib/cron/lease", () => ({
  withWorkspaceScanLease: async (_ws: string, work: (signal: AbortSignal) => Promise<unknown>) => {
    if (state.busy) throw new (await import("@/lib/cron/lease-error")).ScanLeaseBusyError();
    return work(new AbortController().signal);
  },
}));
vi.mock("@/lib/plans/limits", async (original) => ({
  ...(await original<typeof import("@/lib/plans/limits")>()),
  assertWithinCount: async () => undefined,
}));
vi.mock("@/lib/collectors/run", () => ({
  runCollector: async ({ sourceId }: { sourceId: string }) => {
    state.collected.push(sourceId);
    return state.scanError ? { error: "upstream failed" } : {};
  },
}));
vi.mock("@/lib/opportunities/run", () => ({ buildOpportunities: async () => ({}) }));
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    state.dbCalls++;
    return {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => state.rows }),
          leftJoin: (_table: unknown, on: SQL) => {
            state.recentJoin = on;
            return {
              where: (predicate: SQL) => {
                state.recentWhere = predicate;
                return { orderBy: () => ({ limit: async () => [
                  { id: "d1", title: "Need a tool", url: "https://news.ycombinator.com/item?id=1", platform: "hn", postedAt: null, collectedAt: new Date(), metadata: { provider: "algolia" }, sourceName: "Search (Hacker News): x" },
                  { id: "d2", title: null, url: "https://example.com/p", platform: "reddit", postedAt: null, collectedAt: new Date(), metadata: { provider: "fixture", mocked: true }, sourceName: null },
                ] }) };
              },
            };
          },
        }),
      }),
      insert: () => ({
        values: (value: Record<string, unknown>) => ({
          onConflictDoNothing: async () => {
            state.writes.push(value);
            state.rows.push({ id: "src-1", name: String(value.name), type: String(value.type), health: state.sourceHealth });
          },
        }),
      }),
    };
  },
}));

import { addSearchSource } from "@/lib/sources/actions";
import { listRecentPosts } from "@/lib/sources/recent";
import { buildSearchSource } from "@/lib/sources/search";

beforeEach(() => {
  state.allowed = true; state.dbCalls = 0; state.rows = []; state.writes = []; state.collected = []; state.scanError = false; state.busy = false; state.sourceHealth = "healthy";
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("buildSearchSource", () => {
  it("builds a Hacker News search with a one-week first scan", () => {
    const built = buildSearchSource({ platform: "hn", query: "  brand   monitoring\n" });
    expect(built).toEqual({ ok: true, source: { name: "Search (Hacker News): brand monitoring", type: "hn", lane: "free",
      config: { queries: ["brand monitoring"], maxPages: 1, lookbackHours: 168, search: true } } });
  });

  it("scopes Reddit to a valid subreddit and Stack Overflow to a valid tag", () => {
    const reddit = buildSearchSource({ platform: "reddit", query: "seo tool", subreddit: "r/SaaS" });
    expect(reddit.ok && reddit.source).toMatchObject({ name: "Search (r/SaaS): seo tool", type: "reddit", lane: "byok", config: { subreddit: "SaaS", query: "seo tool" } });
    const so = buildSearchSource({ platform: "stackoverflow", query: "sitemap", tag: "Next.js" });
    expect(so.ok && so.source).toMatchObject({ name: "Search (Stack Overflow [next.js]): sitemap", config: { tagged: "next.js", query: "sitemap" } });
    const gh = buildSearchSource({ platform: "github", query: "llms.txt" });
    expect(gh.ok && gh.source).toMatchObject({ type: "github", config: { query: "llms.txt is:open", lookbackHours: 168 } });
    expect(so.ok && so.source).toMatchObject({ config: { lookbackHours: 168 } });
  });

  it("rejects unknown platforms, bad phrases, subreddits and tags", () => {
    expect(buildSearchSource({ platform: "facebook", query: "seo" }).ok).toBe(false);
    expect(buildSearchSource({ platform: "__proto__", query: "seo" }).ok).toBe(false);
    expect(buildSearchSource({ platform: "hn", query: "x" }).ok).toBe(false);
    expect(buildSearchSource({ platform: "hn", query: "a".repeat(101) }).ok).toBe(false);
    expect(buildSearchSource({ platform: "reddit", query: "seo", subreddit: "../etc" }).ok).toBe(false);
    expect(buildSearchSource({ platform: "stackoverflow", query: "seo", tag: "two tags" }).ok).toBe(false);
  });
});

describe("addSearchSource", () => {
  it("refuses an unauthorized workspace before touching the database", async () => {
    state.allowed = false;
    expect(await addSearchSource("ws", {}, form({ platform: "hn", query: "seo tool" }))).toEqual({ error: "Unable to add sources for this workspace." });
    expect(state.dbCalls).toBe(0);
  });

  it("returns validation errors without touching the database", async () => {
    expect(await addSearchSource("ws", {}, form({ platform: "hn", query: "x" }))).toHaveProperty("error");
    expect(state.dbCalls).toBe(0);
  });

  it("adds the search to the workspace and scans it straight away", async () => {
    const result = await addSearchSource("ws", {}, form({ platform: "hn", query: "brand monitoring" }));
    expect(result.message).toBe('Search added. Source scanned. The opportunity queue is refreshed. Anything it found is listed under "Latest posts found".');
    expect(state.writes).toEqual([expect.objectContaining({ workspaceId: "ws", name: "Search (Hacker News): brand monitoring", type: "hn" })]);
    expect(state.collected).toEqual(["src-1"]);
  });

  it("tells the customer when another scan holds the workspace lease", async () => {
    state.busy = true;
    expect(await addSearchSource("ws", {}, form({ platform: "hn", query: "brand monitoring" })))
      .toEqual({ error: "A scan is already running for this workspace. Try again in a minute." });
  });

  it("passes a paused scan through instead of claiming posts were found", async () => {
    state.sourceHealth = "paused";
    const result = await addSearchSource("ws", {}, form({ platform: "hn", query: "brand monitoring" }));
    expect(result.message).toContain("This source is paused.");
    expect(state.collected).toEqual([]);
  });

  it("keeps the search and explains when the first scan fails", async () => {
    state.scanError = true;
    const result = await addSearchSource("ws", {}, form({ platform: "hn", query: "brand monitoring" }));
    expect(result.error).toContain("first scan did not finish");
    expect(state.writes).toHaveLength(1);
  });
});

describe("listRecentPosts", () => {
  it("pins the document and the joined source to the workspace and labels sample data", async () => {
    const posts = await listRecentPosts("ws-1");
    const dialect = new PgDialect();
    const where = dialect.sqlToQuery(state.recentWhere!);
    const join = dialect.sqlToQuery(state.recentJoin!);
    expect(where.sql).toContain('"document"."workspace_id" = $1');
    expect(where.params).toEqual(["ws-1"]);
    expect(join.sql).toContain('"source"."workspace_id" = $1');
    expect(join.params).toEqual(["ws-1"]);
    expect(posts.map((p) => [p.title, p.sample])).toEqual([["Need a tool", false], ["https://example.com/p", true]]);
  });
});
