import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  inserted: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth/server", () => ({
  auth: {
    getSession: async () => ({
      data: state.userId ? { user: { id: state.userId } } : null,
    }),
  },
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        state.inserted.push({
          table: (table as { _?: { name?: string } })?._?.name ?? "unknown",
          values,
        });
        return {
          returning: async () => [{ id: "row-1" }],
        };
      },
    }),
  }),
}));

import * as dbActions from "@/lib/db/actions";

beforeEach(() => {
  state.userId = null;
  state.inserted = [];
});

describe("db server actions contract", () => {
  it("exports no unauthenticated write action", () => {
    expect(Object.keys(dbActions).sort()).toEqual([
      "createWorkspaceForCurrentUser",
    ]);
  });

  it("does not expose the removed smoke-test insert helper", () => {
    expect(
      (dbActions as Record<string, unknown>).insertDocumentAndLead,
    ).toBeUndefined();
  });

  it("rejects workspace creation without a session", async () => {
    await expect(
      dbActions.createWorkspaceForCurrentUser("acme"),
    ).rejects.toThrow("Unauthorized");
    expect(state.inserted).toHaveLength(0);
  });

  it("creates a workspace owned by the signed-in user", async () => {
    state.userId = "user-1";
    await expect(
      dbActions.createWorkspaceForCurrentUser("acme"),
    ).resolves.toEqual({ id: "row-1" });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]?.values).toMatchObject({
      name: "acme",
      ownerUserId: "user-1",
      plan: "free",
    });
  });
});
