import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  failBatch: false,
  batches: [] as unknown[][],
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth/server", () => ({
  auth: {
    getSession: async () => ({ data: state.userId ? { user: { id: state.userId } } : null }),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        return { onConflictDoUpdate: () => ({ table, values }) , table, values };
      },
    }),
    batch: async (queries: Array<{ table: unknown; values: Record<string, unknown> }>) => {
      if (state.failBatch) throw new Error("db down");
      state.batches.push(queries);
      for (const q of queries) state.inserts.push({ table: q.table, values: q.values });
    },
  }),
}));

import { isAdmin, parseAdminIds, requireAdmin } from "@/lib/auth/admin";
import { sourceSwitch, sourceSwitchLog } from "@/lib/db/schema";
import { updateSwitch } from "@/app/admin/switches/actions";
import { GET, PUT } from "@/app/api/admin/switches/route";

const put = (body: unknown) =>
  PUT(new Request("https://x.test/api/admin/switches", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  state.userId = null;
  state.failBatch = false;
  state.batches = [];
  state.inserts = [];
  vi.stubEnv("VANTAGE_ADMIN_USER_IDS", "admin-1, admin-2");
});

describe("PUT body validation", () => {
  it("answers 400, not 500, for JSON null, arrays and primitives", async () => {
    state.userId = "admin-1";
    for (const body of [null, [], "text", 42]) {
      const res = await put(body);
      expect(res.status).toBe(400);
    }
    expect(state.batches).toHaveLength(0);
  });
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
    const res = await put({ sourceKey: "reddit", state: "paused", reason: " API closing " });
    expect(res.status).toBe(200);
    const sw = state.inserts.find((i) => i.table === sourceSwitch);
    const log = state.inserts.find((i) => i.table === sourceSwitchLog);
    expect(sw?.values).toMatchObject({ sourceKey: "reddit", state: "paused", reason: "API closing", changedBy: "admin-1" });
    expect(log?.values).toMatchObject({
      sourceKey: "reddit",
      toState: "paused",
      reason: "API closing",
      changedBy: "admin-1",
    });
  });

  it("writes the audit row and the switch in one batch, log first, from_state read in SQL", async () => {
    state.userId = "admin-1";
    await put({ sourceKey: "reddit", state: "paused" });
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].map((q) => (q as { table: unknown }).table)).toEqual([sourceSwitchLog, sourceSwitch]);
    const logValues = (state.batches[0][0] as { values: Record<string, unknown> }).values;
    expect(typeof logValues.fromState).toBe("object");
  });

  it("returns a generic 500 and writes nothing when the batch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.userId = "admin-1";
    state.failBatch = true;
    const res = await put({ sourceKey: "reddit", state: "paused" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("db down");
    expect(state.inserts).toHaveLength(0);
  });

  it("validates input", async () => {
    state.userId = "admin-1";
    await put({ sourceKey: "x", state: "blocked" });
    expect(state.inserts.find((i) => i.table === sourceSwitchLog)?.values.toState).toBe("blocked");
    state.inserts = [];
    expect((await put({ sourceKey: "nope", state: "paused" })).status).toBe(400);
    expect((await put({ sourceKey: "x", state: "weird" })).status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });
});

describe("updateSwitch server action", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("rejects non-admins with not-found and writes nothing", async () => {
    state.userId = "someone-else";
    await expect(updateSwitch(form({ sourceKey: "reddit", state: "paused" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.inserts).toHaveLength(0);
  });

  it("gives feedback on invalid input, saves for admins, and reports DB failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.userId = "admin-1";
    await expect(updateSwitch(form({ sourceKey: "nope", state: "paused" }))).rejects.toThrow("status=invalid");
    await expect(updateSwitch(form({ sourceKey: "reddit", state: "paused" }))).rejects.toThrow("status=saved&key=reddit");
    expect(state.batches).toHaveLength(1);
    state.failBatch = true;
    await expect(updateSwitch(form({ sourceKey: "reddit", state: "on" }))).rejects.toThrow("status=failed");
  });
});
