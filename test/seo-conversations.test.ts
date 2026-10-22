import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const WS_EMPTY = "33333333-3333-4333-8333-333333333333";
const CONV_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONV_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MSG_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MSG_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = new Date("2026-10-19T12:00:00.000Z");

type Row = Record<string, unknown>;
type Call = {
  op: "select" | "insert" | "update";
  table: string;
  where?: SQL;
  orderBy?: SQL[];
  limit?: number;
  values?: Row;
  returning?: boolean;
};

// Shared with the hoisted db mock below. The mock evaluates each compiled WHERE clause
// against the stored rows, so a query only sees rows whose columns match its bound params.
const store = vi.hoisted(() => ({
  conversations: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  calls: [] as Array<Record<string, unknown>>,
  batches: 0,
}));

vi.mock("@/lib/db/client", async () => {
  const { getTableConfig, PgDialect: Dialect } = await import("drizzle-orm/pg-core");
  const schema = await import("@/lib/db/schema");
  const dialect = new Dialect();

  const compile = (pred: SQL | undefined) => (pred ? dialect.sqlToQuery(pred) : { sql: "", params: [] as unknown[] });
  const tableRows = (table: unknown) => (table === schema.seoConversation ? store.conversations : store.messages);
  const nameOf = (table: unknown) => getTableConfig(table as Parameters<typeof getTableConfig>[0]).name;
  const snake = (column: string) => column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  // Every `"column" = $n` equality in the compiled WHERE must hold for a row to match.
  const matches = (row: Record<string, unknown>, pred: SQL | undefined) => {
    const { sql: text, params } = compile(pred);
    for (const [, column, index] of text.matchAll(/(?:"\w+"\.)?"(\w+)" = \$(\d+)/g)) {
      if (row[snake(column!)] !== params[Number(index) - 1]) return false;
    }
    return true;
  };
  const copy = (row: Record<string, unknown>) => ({ ...row });

  function select() {
    let table: unknown;
    let where: SQL | undefined;
    let orderBy: SQL[] = [];
    let limit: number | undefined;
    const builder = {
      from(t: unknown) {
        table = t;
        return builder;
      },
      where(pred: SQL) {
        where = pred;
        return builder;
      },
      orderBy(...args: SQL[]) {
        orderBy = args;
        return builder;
      },
      limit(n: number) {
        limit = n;
        return builder;
      },
      then(resolve: (rows: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve()
          .then(() => {
            store.calls.push({ op: "select", table: nameOf(table), where, orderBy, limit } satisfies Call);
            const rows = tableRows(table).filter((row) => matches(row, where)).map(copy);
            return limit === undefined ? rows : rows.slice(0, limit);
          })
          .then(resolve, reject);
      },
    };
    return builder;
  }

  function insert(table: unknown) {
    return {
      values(values: Row) {
        const apply = () => {
          store.calls.push({ op: "insert", table: nameOf(table), values } satisfies Call);
          const row = { id: crypto.randomUUID(), createdAt: NOW, updatedAt: NOW, ...values };
          tableRows(table).push(row);
          return [{ id: row.id }];
        };
        return {
          returning: () => ({ then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(apply).then(res, rej) }),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(apply).then(res, rej),
        };
      },
    };
  }

  function update(table: unknown) {
    return {
      set(values: Row) {
        let where: SQL | undefined;
        let returning = false;
        const apply = () => {
          store.calls.push({ op: "update", table: nameOf(table), where, values, returning } satisfies Call);
          const matched = tableRows(table).filter((row) => matches(row, where));
          for (const row of matched) Object.assign(row, values);
          return matched.map(copy);
        };
        const builder = {
          where(pred: SQL) {
            where = pred;
            return builder;
          },
          returning() {
            returning = true;
            return builder;
          },
          then(resolve: (rows: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
            return Promise.resolve().then(apply).then(resolve, reject);
          },
        };
        return builder;
      },
    };
  }

  const db = {
    select,
    insert,
    update,
    batch: async (ops: PromiseLike<unknown>[]) => {
      store.batches++;
      const out: unknown[] = [];
      for (const op of ops) out.push(await op);
      return out;
    },
  };
  return { getDb: () => db };
});

import {
  appendMessage,
  claimPlan,
  unclaimPlan,
  createConversation,
  getConversation,
  listConversations,
} from "@/lib/seo-agent/conversations";

const dialect = new PgDialect();
const sqlOf = (node: SQL) => dialect.sqlToQuery(node);
const callsOf = (op: Call["op"], table?: string) =>
  store.calls.filter((c) => c.op === op && (table === undefined || c.table === table)) as unknown as Call[];

beforeEach(() => {
  store.conversations = [
    { id: CONV_A, workspaceId: WS_A, title: "Keyword gaps", createdAt: NOW, updatedAt: NOW },
    { id: CONV_B, workspaceId: WS_B, title: "Other workspace", createdAt: NOW, updatedAt: NOW },
  ];
  store.messages = [
    {
      id: MSG_A,
      conversationId: CONV_A,
      workspaceId: WS_A,
      role: "assistant",
      content: "Here is the plan",
      parts: { plan: [{ tool: "backlinks", input: { target: "example.com" }, credits: 2 }] },
      status: "needs_approval",
      creditsUsed: 0,
      createdAt: NOW,
    },
    {
      id: MSG_B,
      conversationId: CONV_B,
      workspaceId: WS_B,
      role: "assistant",
      content: "Other plan",
      parts: { plan: [{ tool: "serp", input: {}, credits: 1 }] },
      status: "needs_approval",
      creditsUsed: 0,
      createdAt: NOW,
    },
  ];
  store.calls = [];
  store.batches = 0;
});

describe("createConversation", () => {
  it("inserts the conversation under the given workspace", async () => {
    const { id } = await createConversation(WS_A, "SEO audit");

    expect(id).toEqual(expect.any(String));
    expect(callsOf("insert", "seo_conversation")).toEqual([
      expect.objectContaining({ values: expect.objectContaining({ workspaceId: WS_A, title: "SEO audit" }) }),
    ]);
  });
});

describe("listConversations", () => {
  it.each(["gtm", "research"] as const)("filters %s in SQL before the limit with workspace-scoped markers", async (lane) => {
    await listConversations(WS_A, 5, lane);
    const call = callsOf("select", "seo_conversation")[0]!;
    const query = sqlOf(call.where!);
    expect(query.sql).toContain(lane === "research" ? "not exists" : " exists");
    expect(query.sql).toContain('"seo_message"."conversation_id" = "seo_conversation"."id"');
    expect(query.params.filter((value) => value === WS_A)).toHaveLength(2);
    expect(query.params).toContain(JSON.stringify({ cards: [{ tool: "gtm_journey" }] }));
    if (lane === "research") expect(query.params).toContain(JSON.stringify({ cards: [{ tool: "onboarding_interview" }] }));
    expect(call.limit).toBe(5);
  });
  it("returns only the workspace's conversations, ordered by updated_at descending", async () => {
    const rows = await listConversations(WS_A);

    expect(rows).toEqual([{ id: CONV_A, title: "Keyword gaps", updatedAt: NOW.toISOString() }]);
    const [call] = callsOf("select", "seo_conversation");
    expect(sqlOf(call!.where!).params).toContain(WS_A);
    expect(call!.limit).toBe(30);
    expect(sqlOf(call!.orderBy![0]!).sql).toContain('"updated_at" desc');
  });

  it("honours an explicit limit", async () => {
    await listConversations(WS_A, 5);
    expect(callsOf("select", "seo_conversation")[0]!.limit).toBe(5);
  });

  it("returns nothing for a workspace without conversations", async () => {
    expect(await listConversations(WS_EMPTY)).toEqual([]);
  });
});

describe("getConversation", () => {
  it("returns the conversation and its messages for its own workspace", async () => {
    const conversation = await getConversation(WS_A, CONV_A);

    expect(conversation).toEqual({
      id: CONV_A,
      title: "Keyword gaps",
      messages: [
        {
          id: MSG_A,
          role: "assistant",
          content: "Here is the plan",
          parts: { plan: [{ tool: "backlinks", input: { target: "example.com" }, credits: 2 }] },
          status: "needs_approval",
          creditsUsed: 0,
          createdAt: NOW.toISOString(),
        },
      ],
    });
  });

  it("returns null for another workspace and reads no messages", async () => {
    expect(await getConversation(WS_B, CONV_A)).toBeNull();
    expect(callsOf("select", "seo_message")).toEqual([]);
  });

  it("binds the caller's workspace id in every query it runs", async () => {
    await getConversation(WS_A, CONV_A);

    const selects = callsOf("select");
    expect(selects.length).toBeGreaterThan(0);
    for (const call of selects) {
      expect(sqlOf(call.where!).params).toContain(WS_A);
    }
  });
});

describe("appendMessage", () => {
  it("stores the message under the id the caller passes, so a run can save its answer under a known id", async () => {
    const MSG = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const { id } = await appendMessage(WS_A, CONV_A, { id: MSG, role: "assistant", content: "Answer." });
    expect(id).toBe(MSG);
    expect(callsOf("insert", "seo_message")).toEqual([
      expect.objectContaining({ values: expect.objectContaining({ id: MSG, role: "assistant", content: "Answer." }) }),
    ]);
  });

  it("inserts the message and bumps the conversation's updated_at in one batch", async () => {
    const { id } = await appendMessage(WS_A, CONV_A, { role: "user", content: "Find keyword gaps" });

    expect(id).toEqual(expect.any(String));
    expect(store.batches).toBe(1);
    expect(callsOf("insert", "seo_message")).toEqual([
      expect.objectContaining({
        values: {
          workspaceId: WS_A,
          conversationId: CONV_A,
          role: "user",
          content: "Find keyword gaps",
          parts: {},
          status: "complete",
          creditsUsed: 0,
        },
      }),
    ]);
    const [update] = callsOf("update", "seo_conversation");
    expect(update!.values).toEqual({ updatedAt: expect.any(Date) });
    expect(sqlOf(update!.where!).params).toEqual(expect.arrayContaining([CONV_A, WS_A]));
    expect(store.conversations[0]!.updatedAt).not.toBe(NOW);
  });

  it("refuses a conversation in another workspace and writes nothing", async () => {
    await expect(appendMessage(WS_A, CONV_B, { role: "user", content: "Sneaky" })).rejects.toThrow(/not found/i);

    expect(store.batches).toBe(0);
    expect(store.messages).toHaveLength(2);
    expect(store.conversations[1]!.updatedAt).toBe(NOW);
  });
});

describe("unclaimPlan", () => {
  it("returns an approved plan to needs_approval with one conditional UPDATE", async () => {
    await claimPlan(WS_A, MSG_A);
    store.calls.length = 0;

    expect(await unclaimPlan(WS_A, MSG_A)).toBe(true);

    const updates = callsOf("update", "seo_message");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.values).toEqual({ status: "needs_approval" });
    expect(updates[0]!.returning).toBe(true);
    const { sql: text, params } = sqlOf(updates[0]!.where!);
    expect(text).toContain('"status" = $');
    expect(params).toEqual(expect.arrayContaining([MSG_A, WS_A, "approved"]));
    expect(store.messages[0]!.status).toBe("needs_approval");
  });

  it("lets the owner claim the plan again after it was returned", async () => {
    await claimPlan(WS_A, MSG_A);
    await unclaimPlan(WS_A, MSG_A);
    expect(await claimPlan(WS_A, MSG_A)).toHaveLength(1);
  });

  it("does nothing to a plan that is not approved, or that belongs to another workspace", async () => {
    expect(await unclaimPlan(WS_A, MSG_A)).toBe(false);
    expect(store.messages[0]!.status).toBe("needs_approval");

    await claimPlan(WS_A, MSG_A);
    expect(await unclaimPlan(WS_A, MSG_B)).toBe(false);
    expect(store.messages[0]!.status).toBe("approved");
  });
});

describe("claimPlan", () => {
  it("approves the plan with one conditional UPDATE and returns the planned calls", async () => {
    const plan = await claimPlan(WS_A, MSG_A);

    expect(plan).toEqual([{ tool: "backlinks", input: { target: "example.com" }, credits: 2 }]);
    expect(callsOf("select")).toEqual([]);
    const updates = callsOf("update", "seo_message");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.values).toEqual({ status: "approved" });
    expect(updates[0]!.returning).toBe(true);
    const { sql: text, params } = sqlOf(updates[0]!.where!);
    expect(text).toContain('"status" = $');
    expect(params).toEqual(expect.arrayContaining([MSG_A, WS_A, "needs_approval"]));
    expect(store.messages[0]!.status).toBe("approved");
  });

  it("returns null when the message belongs to another workspace", async () => {
    expect(await claimPlan(WS_A, MSG_B)).toBeNull();
    expect(store.messages[1]!.status).toBe("needs_approval");
  });

  it("returns null when the plan was already claimed", async () => {
    expect(await claimPlan(WS_A, MSG_A)).toHaveLength(1);
    expect(await claimPlan(WS_A, MSG_A)).toBeNull();
  });

  it("returns an empty plan when the message carries no planned calls", async () => {
    store.messages[0] = { ...store.messages[0], parts: {} };
    expect(await claimPlan(WS_A, MSG_A)).toEqual([]);
  });
});
