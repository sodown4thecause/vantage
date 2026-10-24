import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** Rows returned by the awaitable builder (selects and .returning() writes). */
  rows: [] as unknown[],
  /** Write captures, one per insert/update: table name plus the values/set payload. */
  writes: [] as { table: string; values?: Record<string, unknown>; set?: Record<string, unknown> }[],
}));

vi.mock("@/lib/db/rows", () => ({
  rowsOf: (result: { rows?: unknown[] }) => result.rows ?? [],
}));

vi.mock("@/lib/db/client", () => {
  const tableName = (table: unknown) =>
    String((table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? "unknown");
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "orderBy", "limit", "onConflictDoNothing", "returning"]) {
    builder[method] = () => builder;
  }
  builder.values = (values: Record<string, unknown>) => {
    const last = state.writes[state.writes.length - 1];
    if (last) last.values = values;
    return builder;
  };
  builder.set = (set: Record<string, unknown>) => {
    const last = state.writes[state.writes.length - 1];
    if (last) last.set = set;
    return builder;
  };
  builder.insert = (table: unknown) => {
    state.writes.push({ table: tableName(table) });
    return builder;
  };
  builder.update = (table: unknown) => {
    state.writes.push({ table: tableName(table) });
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(state.rows).then(resolve, reject);
  return {
    getDb: () => ({
      ...builder,
      execute: mockExecute,
    }),
  };
});

const mockExecute = vi.hoisted(() => vi.fn());

import {
  addLedgerRows,
  approveProfile,
  ensureContentProfile,
  getContentProfile,
  getLedgerRow,
  isProfileApprovalCurrent,
  ledgerVectorIds,
  listLedger,
  profileHash,
  saveProfileDraft,
} from "@/lib/content/repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";

const profile = {
  audience: "Developers evaluating intent signals",
  facts: ["Vantage reads Reddit and Hacker News"],
  bannedClaims: ["We guarantee first-page rankings"],
  voiceSamples: ["I built this because..."],
  bannedPhrases: ["game-changer"],
  houseStyle: "Plain, direct, dry humour.",
  competitors: ["competitor-a.com", "competitor-b.com", "competitor-c.com"],
};

function profileRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId,
    status: "draft",
    ...profile,
    draft: {},
    sourcePages: [],
    approvedHash: null,
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  state.rows = [];
  state.writes = [];
  mockExecute.mockReset();
});

describe("content profile repository", () => {
  it("reads the workspace's single profile row", async () => {
    state.rows = [profileRow()];
    await expect(getContentProfile(workspaceId)).resolves.toMatchObject({ workspaceId });
  });

  it("creates the profile with provenance, never overwriting an existing row", async () => {
    state.rows = [profileRow()];
    const page = { url: "https://example.com/", title: "Home", scrapedAt: new Date().toISOString() };
    await expect(ensureContentProfile(workspaceId, [page])).resolves.toMatchObject({ workspaceId });
    expect(state.writes).toEqual([{ table: "content_profiles" }]);
  });

  it("saves the LLM draft without touching owner fields", async () => {
    await saveProfileDraft(workspaceId, profile);
    const write = state.writes[0];
    expect(write.table).toBe("content_profiles");
    expect(write.set).toMatchObject({ draft: profile });
    expect(write.set?.facts).toBeUndefined();
  });

  it("approves the owner's profile with a hash over the exact revision", async () => {
    state.rows = [profileRow({ status: "approved", approvedHash: profileHash(profile) })];
    await expect(approveProfile(workspaceId, profile)).resolves.toMatchObject({ status: "approved" });
    const write = state.writes[0];
    expect(write.table).toBe("content_profiles");
    expect(write.set?.approvedHash).toBeTypeOf("string");
    expect(write.set?.facts).toEqual(profile.facts);
  });

  it("marks an edit stale: a changed profile no longer matches its approved hash", () => {
    const approved = profileRow({ status: "approved", approvedHash: profileHash(profile) });
    expect(isProfileApprovalCurrent(approved as never)).toBe(true);
    const edited = profileRow({ status: "approved", approvedHash: profileHash(profile), facts: ["changed"] });
    expect(isProfileApprovalCurrent(edited as never)).toBe(false);
    const unapproved = profileRow({ approvedHash: profileHash(profile) });
    expect(isProfileApprovalCurrent(unapproved as never)).toBe(false);
  });
});

describe("content ledger repository", () => {
  it("rejects rows without an http URL before touching the database", async () => {
    await expect(addLedgerRows(workspaceId, [{ url: "javascript:alert(1)" }])).resolves.toEqual([]);
    expect(state.writes).toEqual([]);
  });

  it("inserts only new URLs, keeping owner metadata on conflicts", async () => {
    state.rows = [{ id: "00000000-0000-4000-8000-000000000002", workspaceId, url: "https://example.com/post" }];
    const added = await addLedgerRows(workspaceId, [
      { url: "https://example.com/post", title: "Post", publishedDate: "2026-10-01" },
    ]);
    expect(added).toHaveLength(1);
    const write = state.writes[0];
    expect(write.table).toBe("content_ledger");
    expect(write.values).toEqual({
      workspaceId,
      url: "https://example.com/post",
      title: "Post",
      targetKeyword: null,
      publishedDate: "2026-10-01",
    });
  });

  it("never returns a ledger row that belongs to another workspace", async () => {
    state.rows = [{ id: "00000000-0000-4000-8000-000000000003", workspaceId: otherWorkspaceId }];
    await expect(getLedgerRow(workspaceId, "00000000-0000-4000-8000-000000000003")).resolves.toBeNull();
  });

  it("reads embedding ids with workspace-bound SQL", async () => {
    mockExecute.mockResolvedValue({ rows: [{ id: "content-ledger:1" }, { id: 42 }] });
    await expect(ledgerVectorIds(workspaceId)).resolves.toEqual(["content-ledger:1"]);
    const call = mockExecute.mock.calls[0][0] as { toQuery?: () => { sql: string; params: unknown[] } };
    const compiled = call.toQuery ? call.toQuery() : { sql: "", params: [] as unknown[] };
    expect(compiled.sql).toContain("content_ledger");
    expect(compiled.params[0]).toBe(workspaceId);
  });

  it("lists the ledger for its workspace", async () => {
    state.rows = [];
    await expect(listLedger(workspaceId)).resolves.toEqual([]);
  });
});
