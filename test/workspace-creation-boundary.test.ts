import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: null as string | null,
  existing: null as { id: string; name: string } | null,
  values: vi.fn(),
  insert: vi.fn(),
  assertCanCreateProject: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { getSession: async () => ({ data: mocks.userId ? { user: { id: mocks.userId } } : null }) },
}));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspace: async () => mocks.existing,
  authorizeWorkspace: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/plans/limits", () => ({ assertCanCreateProject: mocks.assertCanCreateProject }));

import { createWorkspaceForCurrentUser } from "@/lib/db/actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.userId = null;
  mocks.existing = null;
  mocks.values.mockReturnValue({ returning: async () => [{ id: "new-workspace" }] });
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.getDb.mockReturnValue({ insert: mocks.insert });
});

describe("workspace creation boundary", () => {
  it("does not reach the database for an unauthenticated submission", async () => {
    await expect(createWorkspaceForCurrentUser("Acme")).rejects.toThrow("Unauthorized");
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.assertCanCreateProject).not.toHaveBeenCalled();
  });

  it.each(["owner-a", "owner-b"])("assigns ownership exclusively from the current session: %s", async (userId) => {
    mocks.userId = userId;
    await createWorkspaceForCurrentUser("Acme");
    expect(mocks.assertCanCreateProject).toHaveBeenCalledExactlyOnceWith(userId);
    expect(mocks.values).toHaveBeenCalledExactlyOnceWith({ name: "Acme", ownerUserId: userId, plan: "free" });
  });

  it("reuses the current user's workspace rather than creating another on retry", async () => {
    mocks.userId = "owner-a";
    mocks.existing = { id: "owned-workspace", name: "Acme" };
    expect(await createWorkspaceForCurrentUser("Retry")).toEqual(mocks.existing);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
