import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ allowed: true, dbCalls: 0, partial: false, writes: [] as Record<string, unknown>[], names: [] as Array<{ name: string }> }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: async () => state.allowed ? { ok: true } : { ok: false, error: "forbidden" } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cron/scan", () => ({ scanWorkspace: async () => ({ collectorResults: state.partial ? [{ error: "collector failed" }] : [], opportunityResults: [] }) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => {
  state.dbCalls++;
  return { select: () => ({ from: () => ({ where: () => ({ limit: async () => state.names }) }) }),
    insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: async () => { state.writes.push(value); } }) }),
  };
} }));
import { addFeed, scanNow } from "@/lib/sources/actions";
beforeEach(() => { state.allowed = true; state.dbCalls = 0; state.partial = false; state.writes = []; state.names = []; });
it("returns correctable feed errors without querying another user's data", async () => {
  const form = new FormData(); form.set("feedUrl", "http://localhost/feed");
  expect(await addFeed("ws", {}, form)).toHaveProperty("error");
  expect(state.dbCalls).toBe(0);
  state.allowed = false; form.set("feedUrl", "https://example.com/feed");
  expect(await addFeed("ws", {}, form)).toHaveProperty("error");
  expect(state.dbCalls).toBe(0);
});
it("creates a free feed once and preserves existing source state on repeat submission", async () => {
  const form = new FormData(); form.set("feedUrl", "https://example.com/feed");
  expect(await addFeed("ws", {}, form)).toHaveProperty("message");
  expect(state.writes[0]).toMatchObject({ workspaceId: "ws", lane: "free", config: { feedUrl: "https://example.com/feed" } });
  state.names = [{ name: String(state.writes[0].name) }];
  await addFeed("ws", {}, form);
  expect(state.writes).toHaveLength(1);
});
it("returns partial scan failure for display instead of throwing", async () => {
  state.partial = true;
  expect(await scanNow("ws")).toEqual({ error: "Some sources could not be scanned. Check Sources & Coverage." });
});
