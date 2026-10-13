import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { document as documentTable } from "@/lib/db/schema";

const state = vi.hoisted(() => ({
  postRows: [] as Array<{ subreddit: string | null; posts: number }>,
  sourceRows: [] as Array<{ config: Record<string, unknown> }>,
  postWhere: undefined as SQL | undefined,
  sourceWhere: undefined as SQL | undefined,
  limits: [] as number[],
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: (predicate: SQL) => {
          if (table === documentTable) {
            state.postWhere = predicate;
            return {
              groupBy: () => ({
                orderBy: () => ({
                  limit: async (n: number) => {
                    state.limits.push(n);
                    return state.postRows;
                  },
                }),
              }),
            };
          }
          state.sourceWhere = predicate;
          return Promise.resolve(state.sourceRows);
        },
      }),
    }),
  }),
}));

import { listSubredditSuggestions } from "@/lib/sources/subreddit-suggestions";

beforeEach(() => {
  state.postRows = [];
  state.sourceRows = [];
  state.postWhere = undefined;
  state.sourceWhere = undefined;
  state.limits = [];
});

describe("listSubredditSuggestions", () => {
  it("scopes both the post counts and the tracked sources to the workspace", async () => {
    await listSubredditSuggestions("ws-1");
    const dialect = new PgDialect();

    const posts = dialect.sqlToQuery(state.postWhere!);
    expect(posts.sql).toContain('"document"."workspace_id" = $1');
    expect(posts.params[0]).toBe("ws-1");
    expect(posts.params).toContain("reddit");
    // Sample data is labelled in the UI and never counted as live posts.
    expect(posts.sql).toContain("'fixture'");

    const tracked = dialect.sqlToQuery(state.sourceWhere!);
    expect(tracked.sql).toContain('"source"."workspace_id" = $1');
    expect(tracked.params[0]).toBe("ws-1");
    expect(tracked.params).toContain("reddit");
  });

  it("drops invalid names, single-post subreddits, nulls and subreddits already tracked case-insensitively", async () => {
    state.postRows = [
      { subreddit: "SaaS", posts: 9 },
      { subreddit: "webdev", posts: 4 },
      { subreddit: "a", posts: 5 },
      { subreddit: "bad-name", posts: 5 },
      { subreddit: "Solo", posts: 1 },
      { subreddit: null, posts: 3 },
      { subreddit: "ExampleTools", posts: 2 },
      { subreddit: "indiehackers", posts: 3 },
      { subreddit: "toolong".padEnd(22, "x"), posts: 6 },
    ];
    state.sourceRows = [{ config: { subreddit: "saas" } }, { config: { subreddit: "r/IndieHackers" } }, { config: {} }];

    expect(await listSubredditSuggestions("ws-1")).toEqual([
      { subreddit: "webdev", posts: 4 },
      { subreddit: "ExampleTools", posts: 2 },
    ]);
  });

  it("keeps the query ordering, returns the first `limit` and asks for at most 20 groups", async () => {
    state.postRows = [
      { subreddit: "Alpha", posts: 12 },
      { subreddit: "Beta", posts: 7 },
      { subreddit: "Gamma", posts: 5 },
      { subreddit: "Delta", posts: 3 },
    ];

    expect(await listSubredditSuggestions("ws-1", 2)).toEqual([
      { subreddit: "Alpha", posts: 12 },
      { subreddit: "Beta", posts: 7 },
    ]);
    expect(state.limits).toEqual([20]);
  });

  it("returns five suggestions by default", async () => {
    state.postRows = ["Aa", "Bb", "Cc", "Dd", "Ee", "Ff", "Gg"].map((subreddit, i) => ({ subreddit, posts: 10 - i }));

    const result = await listSubredditSuggestions("ws-1");
    expect(result.map((s) => s.subreddit)).toEqual(["Aa", "Bb", "Cc", "Dd", "Ee"]);
  });
});
