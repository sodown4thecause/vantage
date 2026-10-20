import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({
  userId: "owner-a" as string | null,
  cookie: undefined as string | undefined,
  owned: [] as Array<{ id: string; name: string }>,
  where: [] as SQL[],
  set: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ auth: { getSession: async () => ({ data: state.userId ? { user: { id: state.userId } } : null }) } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined, set: state.set }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: (query: SQL) => {
      state.where.push(query);
      const compiled = new PgDialect().sqlToQuery(query);
      const requested = compiled.params[0];
      return Object.assign(Promise.resolve(state.owned), { limit: async () => state.owned.filter((row) => row.id === requested) });
    } }) }),
  }),
}));

import { getCurrentWorkspace, listOwnedWorkspaces, setCurrentWorkspace, WORKSPACE_COOKIE } from "@/lib/auth/workspace";
import { switchWorkspace } from "@/app/workspaces/actions";

beforeEach(() => {
  state.userId = "owner-a";
  state.cookie = undefined;
  state.owned = [{ id: A, name: "First product" }, { id: B, name: "Second product" }];
  state.where = [];
  state.set.mockReset();
});

describe("workspace selection boundary", () => {
  it("scopes every listed workspace to the authenticated owner", async () => {
    expect(await listOwnedWorkspaces()).toEqual(state.owned);
    const query = new PgDialect().sqlToQuery(state.where[0]);
    expect(query.sql).toContain('"workspace"."owner_user_id" =');
    expect(query.params).toEqual(["owner-a"]);
  });

  it("restores the selected owned workspace on subsequent requests", async () => {
    state.cookie = B;
    expect((await getCurrentWorkspace())?.id).toBe(B);
    expect((await getCurrentWorkspace())?.id).toBe(B);
  });

  it.each([FOREIGN, "not-a-uuid", "deleted-workspace"])("ignores a stale or foreign selection: %s", async (cookie) => {
    state.cookie = cookie;
    expect((await getCurrentWorkspace())?.id).toBe(A);
  });

  it("does not leak a previous user's selection to a different signed-in owner", async () => {
    state.cookie = A;
    state.userId = "owner-b";
    state.owned = [{ id: FOREIGN, name: "Owner B's product" }];
    expect((await getCurrentWorkspace())?.id).toBe(FOREIGN);
    expect(new PgDialect().sqlToQuery(state.where[0]).params).toEqual(["owner-b"]);
  });

  it("rejects unauthenticated reads and selection writes", async () => {
    state.userId = null;
    expect(await listOwnedWorkspaces()).toEqual([]);
    expect(await getCurrentWorkspace()).toBeNull();
    expect(await setCurrentWorkspace(A)).toBe(false);
    expect(state.where).toHaveLength(0);
    expect(state.set).not.toHaveBeenCalled();
  });

  it.each([FOREIGN, "not-a-uuid"])("refuses a tampered switch without setting a cookie: %s", async (id) => {
    const form = new FormData();
    form.set("workspaceId", id);
    expect((await switchWorkspace({ error: "" }, form)).error).toContain("Unable to open");
    expect(state.set).not.toHaveBeenCalled();
  });

  it("authorizes both the workspace id and owner before persisting a switch", async () => {
    const form = new FormData();
    form.set("workspaceId", B);
    await expect(switchWorkspace({ error: "" }, form)).rejects.toThrow("REDIRECT:/setup");
    const query = new PgDialect().sqlToQuery(state.where[0]);
    expect(query.sql).toContain('"workspace"."id" =');
    expect(query.sql).toContain('"workspace"."owner_user_id" =');
    expect(query.params).toEqual([B, "owner-a"]);
    expect(state.set).toHaveBeenCalledExactlyOnceWith(WORKSPACE_COOKIE, B, expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 31536000 }));
  });
});
