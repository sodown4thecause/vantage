import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  workspaceFound: false,
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
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.workspaceFound ? [{ id: "workspace-1" }] : []),
        }),
      }),
    }),
  }),
}));

import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";

beforeEach(() => {
  state.userId = null;
  state.workspaceFound = false;
});

describe("authorizeWorkspace", () => {
  it("chooses an owned workspace only for the signed-in user", async () => {
    expect(await getCurrentWorkspace()).toBeNull();
    state.userId = "user-1";
    expect(await getCurrentWorkspace()).toBeNull();
    state.workspaceFound = true;
    expect(await getCurrentWorkspace()).toEqual({ id: "workspace-1" });
  });
  it("rejects unauthenticated requests", async () => {
    await expect(authorizeWorkspace("workspace-1")).resolves.toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
  });

  it("rejects authenticated users who do not own the workspace", async () => {
    state.userId = "user-1";
    await expect(authorizeWorkspace("workspace-1")).resolves.toEqual({
      ok: false,
      status: 403,
      error: "forbidden",
    });
  });

  it("allows the workspace owner", async () => {
    state.userId = "user-1";
    state.workspaceFound = true;
    await expect(authorizeWorkspace("workspace-1")).resolves.toEqual({
      ok: true,
      userId: "user-1",
    });
  });
});
