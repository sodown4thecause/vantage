import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { workspace } from "@/lib/db/schema";

const OWNER = "user-owner";
const STRANGER = "user-stranger";

const state = vi.hoisted(() => ({
  sessionUserId: null as string | null,
  workspaceOwned: false,
  leadRows: [{ id: "lead-1" }] as unknown[],
  writes: [] as Array<{ kind: "insert" | "update"; values: Record<string, unknown> }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/auth/server", () => ({
  auth: {
    getSession: async () => ({
      data: state.sessionUserId ? { user: { id: state.sessionUserId } } : null,
    }),
  },
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          state.writes.push({ kind: "insert", values });
          return [{ id: "row-1" }];
        },
        onConflictDoNothing: async () => {
          state.writes.push({ kind: "insert", values });
          return [];
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.writes.push({ kind: "update", values });
        },
      }),
    }),
    select: () => {
      const chain: Record<string, unknown> = {};
      let selectedTable: unknown = null;
      const rows = () =>
        // The workspace lookup backs authorizeWorkspace; every other select
        // (the outcome recorder's lead check) uses the generic rows.
        selectedTable === workspace
          ? state.workspaceOwned
            ? [{ id: "workspace-1" }]
            : []
          : state.leadRows;
      chain.from = (table: unknown) => {
        selectedTable = table;
        return chain;
      };
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = async () => rows();
      chain.then = (
        onFulfilled: (value: unknown) => unknown,
        onRejected: (reason: unknown) => unknown,
      ) => Promise.resolve(rows()).then(onFulfilled, onRejected);
      return chain;
    },
  }),
}));

import { createWorkspaceFromForm } from "@/app/actions/workspace";
import { createSource, setSourcePaused } from "@/app/actions/source";
import { setLeadStatus } from "@/app/actions/lead";
import { recordOutcomeFromForm } from "@/app/actions/outcome";
import {
  unsubscribeDigest,
  updateDigestPreferences,
} from "@/app/actions/digest";

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

/** Every mutating action with a representative, otherwise-valid payload. */
const MUTATIONS: Array<{
  name: string;
  run: () => Promise<{ error: string | null }>;
}> = [
  {
    name: "createSource",
    run: () =>
      createSource(
        { error: null },
        form({
          workspaceId: "workspace-1",
          name: "Acme blog",
          type: "rss",
          feedUrl: "https://example.com/feed.xml",
        }),
      ),
  },
  {
    name: "setSourcePaused",
    run: () =>
      setSourcePaused(
        { error: null },
        form({ workspaceId: "workspace-1", sourceId: "source-1", paused: "true" }),
      ),
  },
  {
    name: "setLeadStatus",
    run: () =>
      setLeadStatus(
        { error: null },
        form({ workspaceId: "workspace-1", leadId: "lead-1", status: "approved" }),
      ),
  },
  {
    name: "recordOutcomeFromForm",
    run: () =>
      recordOutcomeFromForm(
        { error: null },
        form({ workspaceId: "workspace-1", leadId: "lead-1", outcomeType: "useful" }),
      ),
  },
  {
    name: "updateDigestPreferences",
    run: () =>
      updateDigestPreferences(
        { error: null },
        form({
          workspaceId: "workspace-1",
          digestEnabled: "on",
          digestEmail: "founder@example.com",
          digestHourUtc: "9",
        }),
      ),
  },
  {
    name: "unsubscribeDigest",
    run: () =>
      unsubscribeDigest({ error: null }, form({ workspaceId: "workspace-1" })),
  },
];

beforeEach(() => {
  state.sessionUserId = null;
  state.workspaceOwned = false;
  state.leadRows = [{ id: "lead-1" }];
  state.writes = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("tenant isolation sweep", () => {
  it.each(MUTATIONS.map((m) => m.name))(
    "refuses %s for anonymous callers without any database write",
    async (name) => {
      const mutation = MUTATIONS.find((m) => m.name === name)!;
      const result = await mutation.run();

      expect(result.error).toBeTruthy();
      expect(state.writes).toHaveLength(0);
    },
  );

  it.each(MUTATIONS.map((m) => m.name))(
    "refuses %s for authenticated non-owners without any database write",
    async (name) => {
      state.sessionUserId = STRANGER;
      state.workspaceOwned = false;
      const mutation = MUTATIONS.find((m) => m.name === name)!;
      const result = await mutation.run();

      expect(result.error).toBe("Not authorized for this workspace.");
      expect(state.writes).toHaveLength(0);
    },
  );

  it.each(MUTATIONS.map((m) => m.name))(
    "allows %s for the workspace owner",
    async (name) => {
      state.sessionUserId = OWNER;
      state.workspaceOwned = true;
      const mutation = MUTATIONS.find((m) => m.name === name)!;
      const result = await mutation.run();

      expect(result.error).toBeNull();
      expect(state.writes.length).toBeGreaterThan(0);
    },
  );

  it("scopes every write to the requested workspace", async () => {
    state.sessionUserId = OWNER;
    state.workspaceOwned = true;
    state.leadRows = [{ id: "lead-1" }];

    for (const mutation of MUTATIONS) {
      state.writes = [];
      await mutation.run();
      for (const write of state.writes) {
        if ("workspaceId" in write.values) {
          expect(write.values.workspaceId).toBe("workspace-1");
        }
      }
    }
  });

  it("creates a workspace owned by the signed-in user only", async () => {
    state.sessionUserId = OWNER;
    // Creating a workspace redirects into the new review queue, which Next
    // signals by throwing; the write is what matters here.
    await expect(
      createWorkspaceFromForm({ error: null }, form({ name: "Acme" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.writes[0]?.values).toMatchObject({
      name: "Acme",
      ownerUserId: OWNER,
      plan: "free",
    });
  });

  it("refuses workspace creation for anonymous callers", async () => {
    const result = await createWorkspaceFromForm(
      { error: null },
      form({ name: "Acme" }),
    );
    expect(result.error).toBe("Could not create the workspace. Please try again.");
    expect(state.writes).toHaveLength(0);
  });
});
