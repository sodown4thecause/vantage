import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const OWNER = "owner-1";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  allowed: true,
  busy: false,
  leaseError: null as Error | null,
  leaseCalls: 0,
  dbCalls: 0,
  workspaceName: "Acme",
  rowFound: true,
  documentIds: [] as string[],
  documentCursor: 0,
  profileIds: [] as string[],
  nameWhere: undefined as SQL | undefined,
  profileWhere: undefined as SQL | undefined,
  documentWhere: [] as SQL[],
  deleteWhere: undefined as SQL | undefined,
  deletes: 0,
  events: [] as string[],
  vectorCalls: [] as Array<{ workspaceId: string; ids: string[] }>,
  vectorsOk: true,
  vectorsThrow: false,
  revalidated: [] as string[],
}));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: async () =>
    state.allowed ? { ok: true, userId: "owner-1" } : { ok: false, status: 403, error: "forbidden" },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/cron/lease", async () => {
  const { ScanLeaseBusyError } = await import("@/lib/cron/lease-error");
  return {
    withWorkspaceScanLease: async (_workspaceId: string, work: (signal: AbortSignal) => Promise<unknown>) => {
      state.leaseCalls++;
      if (state.leaseError) throw state.leaseError;
      if (state.busy) throw new ScanLeaseBusyError();
      return work(new AbortController().signal);
    },
  };
});
vi.mock("@/lib/embeddings/store", () => ({
  deleteVectors: async (workspaceId: string, ids: string[]) => {
    state.events.push("vectors");
    state.vectorCalls.push({ workspaceId, ids });
    if (state.vectorsThrow) throw new Error("https://vectorize.internal.example/v2 token=secret rejected");
    return state.vectorsOk;
  },
  upsertVectors: async () => true,
  queryVectors: async () => null,
}));
vi.mock("@/lib/db/client", async () => {
  const schema = await import("@/lib/db/schema");
  // A thenable that also answers .limit() and .orderBy().limit(), like the drizzle builders the code uses.
  const query = (fetch: (limit: number) => Promise<unknown[]>) => ({
    limit: (n: number) => fetch(n),
    orderBy: () => ({ limit: (n: number) => fetch(n) }),
    then: (resolve: (rows: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      fetch(Number.POSITIVE_INFINITY).then(resolve, reject),
  });
  return {
    getDb: () => {
      state.dbCalls++;
      return {
        select: () => ({
          from: (table: unknown) => ({
            where: (predicate: SQL) => {
              if (table === schema.workspace) {
                state.nameWhere = predicate;
                return query(async () => [{ name: state.workspaceName }]);
              }
              if (table === schema.monitoringProfile) {
                state.profileWhere = predicate;
                return query(async () => state.profileIds.map((id) => ({ id })));
              }
              if (table === schema.document) {
                state.documentWhere.push(predicate);
                return query(async (n) => {
                  const page = state.documentIds.slice(state.documentCursor, state.documentCursor + n);
                  state.documentCursor += n;
                  return page.map((id) => ({ id }));
                });
              }
              throw new Error("unexpected select");
            },
          }),
        }),
        delete: (table: unknown) => ({
          where: (predicate: SQL) => {
            if (table !== schema.workspace) throw new Error("unexpected delete");
            state.deleteWhere = predicate;
            return {
              returning: async () => {
                state.deletes++;
                state.events.push("delete-row");
                return state.rowFound ? [{ id: WORKSPACE }] : [];
              },
            };
          },
        }),
      };
    },
  };
});

import { deleteWorkspace } from "@/lib/workspace/actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

function paramsOf(predicate: SQL | undefined): unknown[] {
  if (!predicate) throw new Error("no predicate was recorded");
  return new PgDialect().sqlToQuery(predicate).params;
}

const REDIRECT = "NEXT_REDIRECT:/onboarding";
const REFUSED = { error: "Unable to delete this workspace." };

beforeEach(() => {
  state.allowed = true;
  state.busy = false;
  state.leaseError = null;
  state.leaseCalls = 0;
  state.dbCalls = 0;
  state.workspaceName = "Acme";
  state.rowFound = true;
  state.documentIds = ["d1", "d2"];
  state.documentCursor = 0;
  state.profileIds = ["p1"];
  state.nameWhere = undefined;
  state.profileWhere = undefined;
  state.documentWhere = [];
  state.deleteWhere = undefined;
  state.deletes = 0;
  state.events = [];
  state.vectorCalls = [];
  state.vectorsOk = true;
  state.vectorsThrow = false;
  state.revalidated = [];
});

describe("deleteWorkspace", () => {
  it("refuses an unauthorized caller before any database call", async () => {
    state.allowed = false;
    expect(await deleteWorkspace(WORKSPACE, {}, form({ confirm: "Acme" }))).toEqual(REFUSED);
    expect(state.dbCalls).toBe(0);
    expect(state.leaseCalls).toBe(0);
    expect(state.deletes).toBe(0);
    expect(state.vectorCalls).toEqual([]);
  });

  it("deletes nothing when the typed name does not match exactly", async () => {
    for (const confirm of ["acme", "Acme Inc", "", "Ac me"]) {
      expect(await deleteWorkspace(WORKSPACE, {}, form({ confirm }))).toEqual({
        error: "Type the workspace name exactly to confirm.",
      });
    }
    expect(await deleteWorkspace(WORKSPACE, {}, new FormData())).toEqual({
      error: "Type the workspace name exactly to confirm.",
    });
    expect(state.leaseCalls).toBe(0);
    expect(state.vectorCalls).toEqual([]);
    expect(state.deletes).toBe(0);
  });

  it("tells the owner when a scan holds the lease and deletes nothing", async () => {
    state.busy = true;
    expect(await deleteWorkspace(WORKSPACE, {}, form({ confirm: "Acme" }))).toEqual({
      error: "A scan is running for this workspace. Try again in a minute.",
    });
    expect(state.vectorCalls).toEqual([]);
    expect(state.deletes).toBe(0);
  });

  it("returns a generic message for unexpected failures without echoing error text", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.leaseError = new Error("connect failed: postgres://user:pw@db.internal/neon");
    const result = await deleteWorkspace(WORKSPACE, {}, form({ confirm: "Acme" }));
    expect(result).toEqual({ error: "Workspace could not be deleted. Please try again." });
    expect(JSON.stringify(result)).not.toContain("postgres");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("postgres");
    spy.mockRestore();
  });

  it("refuses when the owned row is already gone, without redirecting", async () => {
    state.rowFound = false;
    expect(await deleteWorkspace(WORKSPACE, {}, form({ confirm: "Acme" }))).toEqual(REFUSED);
    expect(state.revalidated).toEqual([]);
  });

  it("removes vectors first, deletes the row scoped to workspace and owner, then redirects", async () => {
    await expect(deleteWorkspace(WORKSPACE, {}, form({ confirm: " Acme " }))).rejects.toThrow(REDIRECT);

    expect(state.revalidated).toEqual(["/"]);
    expect(paramsOf(state.nameWhere)).toEqual(expect.arrayContaining([WORKSPACE, OWNER]));
    expect(paramsOf(state.deleteWhere)).toEqual([WORKSPACE, OWNER]);
    expect(state.deletes).toBe(1);
    expect(state.events.at(-1)).toBe("delete-row");
    expect(state.events.slice(0, -1).every((event) => event === "vectors")).toBe(true);

    const ids = state.vectorCalls.flatMap((call) => call.ids);
    expect(state.vectorCalls.every((call) => call.workspaceId === WORKSPACE)).toBe(true);
    expect(ids).toEqual(expect.arrayContaining(["doc:d1", "doc:d2", "profile:p1:0", "profile:p1:63", "material:p1:0", "material:p1:63"]));
    expect(ids).toHaveLength(2 + 128);
    for (const where of state.documentWhere) expect(paramsOf(where)).toContain(WORKSPACE);
    expect(paramsOf(state.profileWhere)).toContain(WORKSPACE);
  });

  it("reads documents in pages so a large workspace is cleaned in batches", async () => {
    state.documentIds = Array.from({ length: 2500 }, (_, i) => `doc-${String(i).padStart(4, "0")}`);
    await expect(deleteWorkspace(WORKSPACE, {}, form({ confirm: "Acme" }))).rejects.toThrow(REDIRECT);

    const documentCalls = state.vectorCalls.filter((call) => call.ids.some((id) => id.startsWith("doc:")));
    expect(documentCalls.map((call) => call.ids.length)).toEqual([1000, 1000, 500]);
    expect(documentCalls.flatMap((call) => call.ids)).toHaveLength(2500);
    expect(state.deletes).toBe(1);
  });

  it("still deletes the row when vector cleanup reports failure", async () => {
    state.vectorsOk = false;
    await expect(deleteWorkspace(WORKSPACE, {}, form({ confirm: "Acme" }))).rejects.toThrow(REDIRECT);
    expect(state.deletes).toBe(1);
  });

  it("still deletes the row when vector cleanup throws, and logs no error text", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.vectorsThrow = true;
    await expect(deleteWorkspace(WORKSPACE, {}, form({ confirm: "Acme" }))).rejects.toThrow(REDIRECT);
    expect(state.deletes).toBe(1);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("vectorize.internal");
    spy.mockRestore();
  });
});
