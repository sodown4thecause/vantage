import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  insertOutcomes: [] as Array<Array<{ id: string }> | Error>,
  updates: [] as Array<Record<string, unknown>>,
  insertValues: [] as unknown[],
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (state.row ? [state.row] : []) }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => { state.insertValues.push(values); return ({
        onConflictDoNothing: () => ({
          returning: async () => {
            const outcome = state.insertOutcomes.shift() ?? [];
            if (outcome instanceof Error) throw outcome;
            return outcome;
          },
        }),
      }); },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(values);
        },
      }),
    }),
  }),
}));

const switchState = vi.hoisted(() => ({
  decision: { enabled: true, state: "on", reason: "" } as {
    enabled: boolean;
    state: string;
    reason: string;
  },
}));
vi.mock("@/lib/sources/switch", () => ({
  getSourceSwitch: async () => switchState.decision,
}));

vi.mock("@/lib/reddit/client", () => ({
  fetchRedditPostsWithMeta: async () => ({
    posts: [{
      id: "fixture-1",
      url: "https://reddit.com/r/test/fixture-1",
      title: "Intentional demo post",
      body: "Fixture body",
      author: "fixture-user",
      subreddit: "test",
      score: 1,
      numComments: 0,
      createdAt: "2026-10-01T00:00:00.000Z",
    }],
    meta: { provider: "fixture" },
    cursor: undefined,
  }),
}));

import { runCollector } from "@/lib/collectors/run";
import { redditCollector } from "@/lib/collectors/reddit";
import type { Collector } from "@/lib/collectors/types";

const sourceRow = {
  id: "source-1",
  workspaceId: "workspace-1",
  type: "hn",
  lane: "free",
  config: {},
  etag: "old-etag",
  lastModified: "old-modified",
  cursor: "old-cursor",
};

const document = {
  workspaceId: "workspace-1",
  sourceId: "source-1",
  urlCanonical: "https://example.com/item",
  platform: "hn" as const,
  contentMd: "body",
  contentHash: "hash",
};

beforeEach(() => {
  state.row = { ...sourceRow };
  state.insertOutcomes = [];
  state.updates = [];
  state.insertValues = [];
  switchState.decision = { enabled: true, state: "on", reason: "" };
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runCollector", () => {
  it("persists incomplete coverage even when the scan returns no matching documents", async () => {
    const result = await runCollector({ collector: { name: "hn", run: async () => ({ documents: [], partial: true, coverageReason: "Remaining pages are deferred." }) }, workspaceId: "workspace-1", sourceId: "source-1" });
    expect(result.receipt).toMatchObject({ coverage: "degraded", reason: "Remaining pages are deferred." });
    expect(state.updates.at(-1)).toHaveProperty("health", "degraded");
  });
  it("blocks paid providers in production before any external call", async () => {
    vi.stubEnv("NODE_ENV", "production");
    state.row = { ...sourceRow, type: "reddit", lane: "paid" };
    const run = vi.fn(async () => ({ documents: [] }));
    const result = await runCollector({ collector: { name: "reddit", run }, workspaceId: "workspace-1", sourceId: "source-1" });
    vi.unstubAllEnvs();
    expect(run).not.toHaveBeenCalled();
    expect(result.receipt?.coverage).toBe("budget_limited");
  });
  it("does not invoke a collector whose global switch is off", async () => {
    switchState.decision = { enabled: false, state: "paused", reason: "Reddit paused" };
    const run = vi.fn(async () => ({ documents: [document] }));
    const result = await runCollector({ collector: { name: "hn", run }, workspaceId: "workspace-1", sourceId: "source-1" });
    expect(run).not.toHaveBeenCalled();
    expect(result.switchedOff).toEqual({ state: "paused", reason: "Reddit paused" });
    expect(result.error).toBeUndefined();
    expect(state.updates).toHaveLength(0);
  });
  it("does not invoke a paused source", async () => {
    state.row = { ...sourceRow, health: "paused" };
    const run = vi.fn(async () => ({ documents: [document] }));
    const result = await runCollector({ collector: { name: "hn", run }, workspaceId: "workspace-1", sourceId: "source-1" });
    expect(run).not.toHaveBeenCalled();
    expect(result.inserted).toBe(0);
  });

  it("rejects synthetic evidence before persistence in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    state.insertOutcomes = [[{ id: "synthetic" }]];
    const result = await runCollector({
      collector: { name: "hn", run: async () => ({ documents: [{ ...document, metadata: { provider: "fixture" } }] }) },
      workspaceId: "workspace-1", sourceId: "source-1",
    });
    vi.unstubAllEnvs();
    expect(result.inserted).toBe(0);
    expect(result.receipt?.coverage).toBe("access_pending");
    expect(state.insertOutcomes).toHaveLength(1);
  });

  it("blocks the real fixture collector before persistence by default in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FIXTURES", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.row = { ...sourceRow, type: "reddit", lane: "byok" };
    state.insertOutcomes = [[{ id: "fixture-1" }]];
    const result = await runCollector({
      collector: redditCollector,
      workspaceId: "workspace-1",
      sourceId: "source-1",
    });

    expect(result).toMatchObject({ inserted: 0, skipped: 0 });
    expect(result.error).toContain("fixture fallback is disabled in production");
    expect(state.insertValues).toHaveLength(0);
    expect(state.insertOutcomes).toHaveLength(1);
  });

  it.each([undefined, "", "false", "TRUE", "1"])(
    "blocks fixture persistence in production when ALLOW_FIXTURES is %s",
    async (allowFixtures) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ALLOW_FIXTURES", allowFixtures);
      vi.spyOn(console, "error").mockImplementation(() => {});
      state.insertOutcomes = [[{ id: "fixture-1" }]];
      const result = await runCollector({
        collector: {
          name: "hn",
          run: async () => ({
            documents: [
              { ...document, contentHash: "live-hash", metadata: { provider: "hn", mocked: false } },
              { ...document, metadata: { provider: "fixture", mocked: true } },
              { ...document, contentHash: "mocked-hash", metadata: { provider: "hn", mocked: true } },
            ],
          }),
        },
        workspaceId: "workspace-1",
        sourceId: "source-1",
      });

      expect(result).toMatchObject({ inserted: 0, skipped: 0 });
      expect(result.error).toContain("synthetic provider output rejected");
      expect(result.receipt?.coverage).toBe("access_pending");
      expect(state.insertValues).toHaveLength(0);
      expect(state.insertOutcomes).toHaveLength(1);
    },
  );

  it("rejects mocked documents even when their provider is not fixture", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FIXTURES", "false");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCollector({
      collector: {
        name: "hn",
        run: async () => ({ documents: [{ ...document, metadata: { provider: "hn", mocked: true } }] }),
      },
      workspaceId: "workspace-1",
      sourceId: "source-1",
    });

    expect(result.inserted).toBe(0);
    expect(result.error).toContain("synthetic provider output rejected");
    expect(state.insertValues).toHaveLength(0);
  });

  it("persists explicitly allowed production fixtures with mocked metadata intact", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FIXTURES", "true");
    state.insertOutcomes = [[{ id: "fixture-1" }]];
    state.row = { ...sourceRow, type: "reddit", lane: "byok" };
    const result = await runCollector({
      collector: redditCollector,
      workspaceId: "workspace-1",
      sourceId: "source-1",
    });

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ inserted: 1, skipped: 0 });
    expect(state.insertValues).toHaveLength(1);
    expect(state.insertValues[0]).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-1",
        sourceId: "source-1",
        platform: "reddit",
        metadata: expect.objectContaining({ provider: "fixture", mocked: true }),
      }),
    ]);
    expect(result.receipt).toMatchObject({ coverage: "degraded", provider: "fixture", resultCount: 1 });
    expect(state.updates.at(-1)).toHaveProperty("health", "degraded");
  });
  it("deduplicates atomically and preserves omitted state while clearing null", async () => {
    state.insertOutcomes = [[{ id: "doc-1" }], []];
    const collector: Collector = {
      name: "test",
      run: async () => ({
        documents: [document, { ...document, urlCanonical: "https://example.com/2" }],
        nextState: { etag: null, cursor: undefined },
      }),
    };

    const result = await runCollector({
      collector,
      workspaceId: "workspace-1",
      sourceId: "source-1",
    });

    expect(result).toMatchObject({ inserted: 1, skipped: 1 });
    expect(state.insertValues).toHaveLength(1);
    expect(state.insertValues[0]).toHaveLength(2);
    expect(state.updates.at(-1)).toMatchObject({
      etag: null,
      lastModified: "old-modified",
      cursor: "old-cursor",
      health: "healthy",
    });
    const config = state.updates.at(-1)?.config;
    const merge = new PgDialect().sqlToQuery(config as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(merge.sql).toContain('"source"."config" ||');
    expect(JSON.parse(String(merge.params[0]))).toHaveProperty("lastRun");
    expect(JSON.parse(String(merge.params[0]))).not.toHaveProperty("queries");
  });

  it("logs and marks the source failed when persistence fails", async () => {
    state.insertOutcomes = [new Error("database unavailable")];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const collector: Collector = {
      name: "test",
      run: async () => ({ documents: [document] }),
    };

    const result = await runCollector({
      collector,
      workspaceId: "workspace-1",
      sourceId: "source-1",
    });

    expect(result.error).toBe("database unavailable");
    expect(errorSpy).toHaveBeenCalled();
    expect(state.updates.at(-1)).toMatchObject({ health: "failed" });
    expect(state.updates.at(-1)?.lastPolledAt).toBeInstanceOf(Date);
  });

  it("reports no partial inserts when the atomic document batch fails", async () => {
    state.insertOutcomes = [new Error("database unavailable")];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const collector: Collector = {
      name: "test",
      run: async () => ({
        documents: [document, { ...document, contentHash: "hash-2" }],
      }),
    };

    const result = await runCollector({
      collector,
      workspaceId: "workspace-1",
      sourceId: "source-1",
    });

    expect(result).toMatchObject({
      inserted: 0,
      skipped: 0,
      error: "database unavailable",
    });
  });
});
