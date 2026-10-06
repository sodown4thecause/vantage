import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  existing: undefined as Record<string, unknown> | undefined,
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth/server", () => ({
  auth: {
    getSession: async () => ({ data: state.userId ? { user: { id: state.userId } } : null }),
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () =>
        Object.assign(Promise.resolve(state.existing ? [state.existing] : []), {
          where: () => ({ limit: async () => (state.existing ? [state.existing] : []) }),
        }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        state.inserts.push({ table, values });
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  }),
}));

import { isAdmin, parseAdminIds, requireAdmin } from "@/lib/auth/admin";
import { sourceSwitch, sourceSwitchLog } from "@/lib/db/schema";
import { GET, PUT } from "@/app/api/admin/switches/route";

const put = (body: unknown) =>
  PUT(new Request("https://x.test/api/admin/switches", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  state.userId = null;
  state.existing = undefined;
  state.inserts = [];
  vi.stubEnv("VANTAGE_ADMIN_USER_IDS", "admin-1, admin-2");
});

describe("admin id parsing", () => {
  it("trims whitespace and drops empties", () => {
    expect(parseAdminIds(" a , b,, ,c ")).toEqual(["a", "b", "c"]);
  });
  it("treats empty or missing env as no admins", () => {
    expect(parseAdminIds("")).toEqual([]);
    expect(parseAdminIds(undefined)).toEqual([]);
    expect(isAdmin("anyone", "")).toBe(false);
    expect(isAdmin("anyone", undefined)).toBe(false);
  });
  it("matches ids exactly and rejects missing users", () => {
    expect(isAdmin("b", " a , b ")).toBe(true);
    expect(isAdmin("bb", "a,b")).toBe(false);
    expect(isAdmin(null, "a")).toBe(false);
    expect(isAdmin("", "a,")).toBe(false);
  });
});

describe("admin switch API", () => {
  it("returns 404 to signed-out users and non-admins", async () => {
    expect((await GET()).status).toBe(404);
    state.userId = "someone-else";
    expect((await GET()).status).toBe(404);
    expect((await put({ sourceKey: "reddit", state: "paused" })).status).toBe(404);
    expect(state.inserts).toHaveLength(0);
  });

  it("requireAdmin raises not-found for non-admins", async () => {
    state.userId = "someone-else";
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    state.userId = "admin-2";
    await expect(requireAdmin()).resolves.toBe("admin-2");
  });

  it("lets an admin flip a switch and writes an audit row", async () => {
    state.userId = "admin-1";
    state.existing = { sourceKey: "reddit", state: "on" };
    const res = await put({ sourceKey: "reddit", state: "paused", reason: " API closing " });
    expect(res.status).toBe(200);
    const sw = state.inserts.find((i) => i.table === sourceSwitch);
    const log = state.inserts.find((i) => i.table === sourceSwitchLog);
    expect(sw?.values).toMatchObject({ sourceKey: "reddit", state: "paused", reason: "API closing", changedBy: "admin-1" });
    expect(log?.values).toMatchObject({
      sourceKey: "reddit",
      fromState: "on",
      toState: "paused",
      reason: "API closing",
      changedBy: "admin-1",
    });
  });

  it("logs from_state on when no row existed, and validates input", async () => {
    state.userId = "admin-1";
    await put({ sourceKey: "x", state: "blocked" });
    expect(state.inserts.find((i) => i.table === sourceSwitchLog)?.values.fromState).toBe("on");
    state.inserts = [];
    expect((await put({ sourceKey: "nope", state: "paused" })).status).toBe(400);
    expect((await put({ sourceKey: "x", state: "weird" })).status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });
});
