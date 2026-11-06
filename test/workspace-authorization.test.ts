import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  workspaceFound: false,
  registration: null as
    | { id: string; status: string; workspaceId: string | null; expiresAt: Date }
    | null,
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

vi.mock("@/lib/agent/registration", () => ({
  drizzleRegistrationStore: () => ({
    findRegistration: async (id: string) =>
      state.registration && state.registration.id === id
        ? { ...state.registration, claimTokenExpiresAt: new Date() }
        : null,
  }),
}));

import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";

beforeEach(() => {
  state.userId = null;
  state.workspaceFound = false;
  state.registration = null;
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

  describe("agent credentials", () => {
    const live = (overrides: Partial<NonNullable<typeof state.registration>> = {}) => {
      state.registration = {
        id: "reg_1",
        status: "active",
        workspaceId: "workspace-1",
        expiresAt: new Date(Date.now() + 86_400_000),
        ...overrides,
      };
    };

    it("allows an active registration bound to the workspace", async () => {
      live();
      await expect(
        authorizeWorkspace("workspace-1", { registrationId: "reg_1", workspaceId: "workspace-1" }),
      ).resolves.toEqual({ ok: true, via: "agent" });
    });

    it("refuses a grant for a different workspace", async () => {
      live();
      await expect(
        authorizeWorkspace("workspace-2", { registrationId: "reg_1", workspaceId: "workspace-1" }),
      ).resolves.toEqual({ ok: false, status: 403, error: "forbidden" });
    });

    it("allows a claimed registration, which is how a claimed agent keeps access", async () => {
      // The claim flow issues post-claim tokens against the same registration.
      live({ status: "claimed", expiresAt: new Date(Date.now() - 1_000) });
      await expect(
        authorizeWorkspace("workspace-1", { registrationId: "reg_1", workspaceId: "workspace-1" }),
      ).resolves.toEqual({ ok: true, via: "agent" });
    });

    it("refuses a registration that is no longer live", async () => {
      for (const status of ["expired", "revoked"]) {
        live({ status });
        await expect(
          authorizeWorkspace("workspace-1", { registrationId: "reg_1", workspaceId: "workspace-1" }),
        ).resolves.toEqual({ ok: false, status: 403, error: "forbidden" });
      }
    });

    it("refuses an expired registration", async () => {
      live({ expiresAt: new Date(Date.now() - 1_000) });
      await expect(
        authorizeWorkspace("workspace-1", { registrationId: "reg_1", workspaceId: "workspace-1" }),
      ).resolves.toEqual({ ok: false, status: 403, error: "forbidden" });
    });

    it("refuses an unknown registration", async () => {
      await expect(
        authorizeWorkspace("workspace-1", { registrationId: "reg_missing", workspaceId: "workspace-1" }),
      ).resolves.toEqual({ ok: false, status: 403, error: "forbidden" });
    });
  });
});
