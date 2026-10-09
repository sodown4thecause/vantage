import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: true,
  inserted: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ values: Record<string, unknown>; where: unknown }>,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: async () =>
    state.authorized
      ? { ok: true, userId: "user-1" }
      : { ok: false, status: 403 as const, error: "forbidden" as const },
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          state.inserted.push(values);
          return [];
        },
        onConflictDoNothing: async () => {
          state.inserted.push(values);
          return [];
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async (where: unknown) => {
          state.updates.push({ values, where });
        },
      }),
    }),
  }),
}));

import { createSource, setSourcePaused } from "@/app/actions/source";

afterEach(() => {
  state.authorized = true;
  state.inserted = [];
  state.updates = [];
});

describe("createSource action", () => {
  it("inserts a validated source for the authorized workspace", async () => {
    const formData = new FormData();
    formData.set("workspaceId", "workspace-1");
    formData.set("name", " Acme blog ");
    formData.set("type", "rss");
    formData.set("feedUrl", "https://example.com/feed.xml");

    const result = await createSource({ error: null }, formData);

    expect(result).toEqual({ error: null, saved: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      workspaceId: "workspace-1",
      name: "Acme blog",
      type: "rss",
      lane: "free",
      config: { feedUrl: "https://example.com/feed.xml" },
    });
  });

  it("refuses to write when the workspace is not authorized", async () => {
    state.authorized = false;
    const formData = new FormData();
    formData.set("workspaceId", "workspace-1");
    formData.set("name", "Acme blog");
    formData.set("type", "rss");
    formData.set("feedUrl", "https://example.com/feed.xml");

    const result = await createSource({ error: null }, formData);

    expect(result.error).toBe("Not authorized for this workspace.");
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses unsafe feed URLs before touching the database", async () => {
    const formData = new FormData();
    formData.set("workspaceId", "workspace-1");
    formData.set("name", "Internal feed");
    formData.set("type", "rss");
    formData.set("feedUrl", "http://169.254.169.254/latest/meta-data/");

    const result = await createSource({ error: null }, formData);

    expect(result.error).toMatch(/public http/);
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses unknown source types and short names", async () => {
    const formData = new FormData();
    formData.set("workspaceId", "workspace-1");
    formData.set("name", "A");
    formData.set("type", "rss");
    formData.set("feedUrl", "https://example.com/feed.xml");
    expect((await createSource({ error: null }, formData)).error).toMatch(
      /at least 2 characters/,
    );

    formData.set("name", "Acme blog");
    formData.set("type", "twitter");
    expect((await createSource({ error: null }, formData)).error).toMatch(
      /source type/,
    );
    expect(state.inserted).toHaveLength(0);
  });
});

describe("setSourcePaused action", () => {
  it("pauses and resumes a workspace-scoped source", async () => {
    const formData = new FormData();
    formData.set("workspaceId", "workspace-1");
    formData.set("sourceId", "source-1");
    formData.set("paused", "true");

    expect(await setSourcePaused({ error: null }, formData)).toEqual({
      error: null,
      saved: true,
    });
    expect(state.updates[0]?.values).toMatchObject({ health: "paused" });

    formData.set("paused", "false");
    await setSourcePaused({ error: null }, formData);
    expect(state.updates[1]?.values).toMatchObject({ health: "healthy" });
  });

  it("does not update sources for unauthorized workspaces", async () => {
    state.authorized = false;
    const formData = new FormData();
    formData.set("workspaceId", "workspace-1");
    formData.set("sourceId", "source-1");
    formData.set("paused", "true");

    const result = await setSourcePaused({ error: null }, formData);

    expect(result.error).toBe("Not authorized for this workspace.");
    expect(state.updates).toHaveLength(0);
  });
});
