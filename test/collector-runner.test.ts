import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  insertResults: [] as Array<Array<{ id: string }>>,
  insertError: null as Error | null,
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
            if (state.insertError) throw state.insertError;
            return state.insertResults.shift() ?? [];
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
  state.insertResults = [];
  state.insertError = null;
  state.updates = [];
  vi.restoreAllMocks();
});

describe("runCollector", () => {
  it("deduplicates atomically and preserves omitted state while clearing null", async () => {
    state.insertResults = [[{ id: "doc-1" }], []];
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
    state.insertError = new Error("database unavailable");
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
});
