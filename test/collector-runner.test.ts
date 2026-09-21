import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  insertOutcomes: [] as Array<Array<{ id: string }> | Error>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (state.row ? [state.row] : []) }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            const outcome = state.insertOutcomes.shift() ?? [];
            if (outcome instanceof Error) throw outcome;
            return outcome;
          },
        }),
      }),
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

import { runCollector } from "@/lib/collectors/run";
import type { Collector } from "@/lib/collectors/types";

const sourceRow = {
  id: "source-1",
  workspaceId: "workspace-1",
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
  vi.restoreAllMocks();
});

describe("runCollector", () => {
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
    expect(state.updates.at(-1)).toMatchObject({
      etag: null,
      lastModified: "old-modified",
      cursor: "old-cursor",
      health: "healthy",
    });
  });

  it("logs and marks the source failing when persistence fails", async () => {
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
    expect(state.updates.at(-1)).toMatchObject({ health: "failing" });
    expect(state.updates.at(-1)?.lastPolledAt).toBeInstanceOf(Date);
  });

  it("reports inserts completed before a later persistence failure", async () => {
    state.insertOutcomes = [
      [{ id: "doc-1" }],
      new Error("database unavailable"),
    ];
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
      inserted: 1,
      skipped: 0,
      error: "database unavailable",
    });
  });
});
