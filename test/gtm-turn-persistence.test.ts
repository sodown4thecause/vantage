import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ owned: true, batches: vi.fn(), predicates: [] as unknown[] }));

vi.mock("@/lib/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/neon-http");
  const builder = drizzle.mock();
  return { getDb: () => ({
    select: () => ({ from: () => ({ where: (predicate: unknown) => {
      state.predicates.push(predicate);
      return { limit: async () => state.owned ? [{ id: "conversation" }] : [] };
    } }) }),
    insert: builder.insert.bind(builder),
    update: builder.update.bind(builder),
    batch: state.batches,
  }) };
});

import { appendMessages } from "@/lib/seo-agent/conversations";

beforeEach(() => {
  state.owned = true;
  state.predicates = [];
  state.batches.mockReset().mockResolvedValue([[{ id: "user" }, { id: "assistant" }], []]);
});

it("inserts the complete ordered turn in one statement and one transactional batch", async () => {
  const rows = await appendMessages("workspace", "conversation", [
    { role: "user", content: "Question" },
    { role: "assistant", content: "Answer", parts: { cards: [{ tool: "gtm_journey", title: "Next", fetchedAt: null, cached: false, data: {} }] } },
  ]);
  expect(rows).toEqual([{ id: "user" }, { id: "assistant" }]);
  expect(state.batches).toHaveBeenCalledOnce();
  const [insert, update] = state.batches.mock.calls[0]![0] as { toSQL(): { sql: string; params: unknown[] } }[];
  const query = insert!.toSQL();
  expect(query.sql).toMatch(/values \(.+\), \(.+\) returning/);
  expect(query.params.filter((value) => value === "workspace")).toHaveLength(2);
  expect(query.params.filter((value) => value === "conversation")).toHaveLength(2);
  expect(query.params.indexOf("Question")).toBeLessThan(query.params.indexOf("Answer"));
  expect(update!.toSQL().params).toEqual(expect.arrayContaining(["workspace", "conversation"]));
  const predicate = new PgDialect().sqlToQuery(state.predicates[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(predicate.params).toEqual(expect.arrayContaining(["workspace", "conversation"]));
});

it("rejects a foreign conversation without writing either half of the turn", async () => {
  state.owned = false;
  await expect(appendMessages("workspace", "foreign", [{ role: "user", content: "Question" }, { role: "assistant", content: "Answer" }])).rejects.toThrow("conversation not found");
  expect(state.batches).not.toHaveBeenCalled();
});

it("propagates a failed transactional save without falling back to separate writes", async () => {
  state.batches.mockRejectedValue(new Error("write failed"));
  await expect(appendMessages("workspace", "conversation", [{ role: "user", content: "Question" }, { role: "assistant", content: "Answer" }])).rejects.toThrow("write failed");
  expect(state.batches).toHaveBeenCalledOnce();
});
