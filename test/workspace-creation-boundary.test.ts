import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  userId: null as string | null,
  existing: null as { id: string; name: string } | null,
  batch: vi.fn(),
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
  mocks.assertCanCreateProject.mockResolvedValue(3);
  mocks.batch.mockResolvedValue([[], { rows: [{ id: "new-workspace", name: "Acme" }] }]);
  mocks.getDb.mockReturnValue({ execute: (query: SQL) => query, batch: mocks.batch });
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
    const queries = mocks.batch.mock.calls[0][0].map((query: SQL) => new PgDialect().sqlToQuery(query));
    expect(queries[0].sql).toContain("pg_advisory_xact_lock");
    expect(queries[0].params).toEqual([userId]);
    expect(queries[1].params).toEqual([userId, "Acme", userId, 3, false]);
    expect(queries[1].sql).toContain('"workspace"."owner_user_id" =');
    expect(queries[1].sql).toContain("owned.n <");
    expect(queries[1].sql).toContain("or owned.n = 0");
  });

  it("reuses the current user's workspace rather than creating another on retry", async () => {
    mocks.userId = "owner-a";
    mocks.existing = { id: "owned-workspace", name: "Acme" };
    expect(await createWorkspaceForCurrentUser("Retry")).toEqual(mocks.existing);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("allows a second workspace only after checking the current owner's plan cap", async () => {
    mocks.userId = "owner-a";
    mocks.existing = { id: "owned-workspace", name: "Acme" };
    await createWorkspaceForCurrentUser("Product two", true);
    expect(mocks.assertCanCreateProject).toHaveBeenCalledExactlyOnceWith("owner-a");
    const insert = new PgDialect().sqlToQuery(mocks.batch.mock.calls[0][0][1]);
    expect(insert.params).toEqual(["owner-a", "Product two", "owner-a", 3, true]);
  });

  it("does not insert an additional workspace when the plan cap refuses", async () => {
    mocks.userId = "owner-a";
    mocks.assertCanCreateProject.mockRejectedValue(new Error("cap reached"));
    await expect(createWorkspaceForCurrentUser("Product two", true)).rejects.toThrow("cap reached");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("refuses when the guarded insert loses the last available slot", async () => {
    mocks.userId = "owner-a";
    mocks.batch.mockResolvedValue([[], { rows: [] }]);
    await expect(createWorkspaceForCurrentUser("Product two", true)).rejects.toThrow("Workspace limit reached");
  });

  it("handles concurrent requests when the database grants only the last available slot", async () => {
    mocks.userId = "owner-a";
    mocks.batch.mockResolvedValueOnce([[], { rows: [{ id: "last-slot", name: "Winner" }] }]);
    mocks.batch.mockResolvedValueOnce([[], { rows: [] }]);
    const results = await Promise.allSettled([
      createWorkspaceForCurrentUser("Product two", true),
      createWorkspaceForCurrentUser("Product three", true),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(mocks.batch).toHaveBeenCalledTimes(2);
    for (const [queries] of mocks.batch.mock.calls) {
      const lock = new PgDialect().sqlToQuery(queries[0]);
      const insert = new PgDialect().sqlToQuery(queries[1]);
      expect(lock.sql).toContain("pg_advisory_xact_lock");
      expect(lock.params).toEqual(["owner-a"]);
      expect(insert.sql).toContain("owned.n <");
      expect(insert.params[3]).toBe(3);
    }
  });

  it("reuses a first workspace created by a concurrent request instead of inserting a second", async () => {
    mocks.userId = "owner-a";
    mocks.batch.mockImplementation(async () => {
      mocks.existing = { id: "concurrent-workspace", name: "Acme" };
      return [[], { rows: [] }];
    });
    expect(await createWorkspaceForCurrentUser("Acme")).toEqual({ id: "concurrent-workspace", name: "Acme" });
  });

  it("reuses the winner when a concurrent first creation reaches the plan cap before the check", async () => {
    mocks.userId = "owner-a";
    mocks.assertCanCreateProject.mockImplementation(async () => {
      mocks.existing = { id: "winning-workspace", name: "Other tab" };
      throw new Error("cap reached");
    });
    expect(await createWorkspaceForCurrentUser("Acme")).toEqual(mocks.existing);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
