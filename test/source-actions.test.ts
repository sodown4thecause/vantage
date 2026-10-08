import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ allowed: true, authorize: vi.fn(), dbCalls: 0, partial: false, writes: [] as Record<string, unknown>[], names: [] as Array<{ name: string }>, lease: Promise.resolve(), sourceLimit: 100, enqueue: vi.fn(async (_message: unknown) => true) }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: state.authorize }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cf/queue", () => ({ enqueueEmbedJob: (message: unknown) => state.enqueue(message) }));
vi.mock("@/lib/cron/scan", () => ({ scanWorkspace: async () => ({ collectorResults: state.partial ? [{ error: "collector failed" }] : [], opportunityResults: [] }) }));
vi.mock("@/lib/cron/lease", () => ({ withWorkspaceScanLease: async (_workspaceId: string, work: (signal: AbortSignal) => Promise<unknown>) => {
  const previous = state.lease; let release!: () => void;
  state.lease = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await work(new AbortController().signal); } finally { release(); }
} }));
vi.mock("@/lib/plans/limits", async original => ({ ...await original<typeof import("@/lib/plans/limits")>(), assertWithinCount: async (_workspace: string, _key: string, count: number) => { if (count >= state.sourceLimit) throw new Error("Source limit reached"); } }));
vi.mock("@/lib/db/client", () => ({ getDb: () => {
  state.dbCalls++;
  return { select: () => ({ from: () => ({ where: () => ({ limit: async () => state.names }) }) }),
    insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: async () => { state.writes.push(value); state.names.push({ name: String(value.name) }); } }) }),
  };
} }));
import { addCommunitySource, addFeed, scanNow } from "@/lib/sources/actions";
beforeEach(() => {
  vi.restoreAllMocks();
  state.allowed = true; state.dbCalls = 0; state.partial = false; state.writes = []; state.names = []; state.lease = Promise.resolve(); state.sourceLimit = 100;
  state.enqueue = vi.fn(async (_message: unknown) => true);
  state.authorize.mockReset();
  state.authorize.mockImplementation(async () => state.allowed ? { ok: true } : { ok: false, error: "forbidden" });
});
it("returns correctable feed errors without querying another user's data", async () => {
  const form = new FormData(); form.set("feedUrl", "http://localhost/feed");
  expect(await addFeed("ws", {}, form)).toHaveProperty("error");
  expect(state.dbCalls).toBe(0);
  state.allowed = false; form.set("feedUrl", "https://example.com/feed");
  expect(await addFeed("ws", {}, form)).toHaveProperty("error");
  expect(state.dbCalls).toBe(0);
});
it("enqueues document backfill for a new source when the semantic mode is shadow", async () => {
  vi.stubEnv("VANTAGE_SEMANTIC_MODE", "shadow");
  const form = new FormData(); form.set("feedUrl", "https://example.com/feed");
  await addFeed("ws", {}, form);
  expect(state.enqueue).toHaveBeenCalledWith({ type: "backfill-documents", workspaceId: "ws" });
  vi.unstubAllEnvs();
});
it("makes no queue call when adding a source and the semantic mode is off", async () => {
  vi.stubEnv("VANTAGE_SEMANTIC_MODE", "off");
  const form = new FormData(); form.set("feedUrl", "https://example.com/feed");
  expect(await addFeed("ws", {}, form)).toHaveProperty("message");
  expect(state.writes).toHaveLength(1);
  expect(state.enqueue).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
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
it("installs an authorized catalog entry once and ignores supplied provider config", async () => {
  const form = new FormData(); form.set("catalogId", "dev-ai"); form.set("config", "http://localhost/secret");
  expect(await addCommunitySource("ws", {}, form)).toMatchObject({ catalogId: "dev-ai", message: expect.any(String) });
  expect(state.writes[0]).toMatchObject({ workspaceId: "ws", type: "rss", lane: "free", config: { feedUrl: "https://dev.to/feed/tag/ai", catalogId: "dev-ai" } });
  state.names = [{ name: String(state.writes[0].name) }];
  expect(await addCommunitySource("ws", {}, form)).toEqual({ catalogId: "dev-ai", message: "This source is already configured." });
  expect(state.writes).toHaveLength(1);
});
it("rejects unauthorized or unknown catalog sources before a database call", async () => {
  const form = new FormData(); form.set("catalogId", "unknown");
  expect(await addCommunitySource("ws", {}, form)).toMatchObject({ catalogId: "unknown", error: expect.any(String) });
  state.allowed = false; form.set("catalogId", "dev-ai");
  expect(await addCommunitySource("ws", {}, form)).toEqual({ catalogId: "dev-ai", error: "Unable to add sources for this workspace." });
  expect(state.dbCalls).toBe(0);
});
it("authenticates before reading catalog input and preserves its identity on authorization failure", async () => {
  const form = new FormData(); form.set("catalogId", "dev-ai");
  const readInput = vi.spyOn(form, "get");
  state.authorize.mockRejectedValue(new Error("private authorization details"));
  expect(await addCommunitySource("ws", {}, form)).toEqual({ catalogId: "dev-ai", error: "Community source could not be added. Please try again." });
  expect(state.authorize.mock.invocationCallOrder[0]).toBeLessThan(readInput.mock.invocationCallOrder[0]);
  expect(state.dbCalls).toBe(0);
});
it("serializes feed and catalog installation under one workspace lease", async () => {
  state.sourceLimit = 8; state.names = [{ name: "Profile: Hacker News" }, ...Array.from({ length: 6 }, (_, i) => ({ name: `source-${i}` }))];
  const catalog = new FormData(); catalog.set("catalogId", "dev-ai");
  const feed = new FormData(); feed.set("feedUrl", "https://example.com/feed");
  const results = await Promise.all([addCommunitySource("ws", {}, catalog), addFeed("ws", {}, feed)]);
  expect(results.filter(result => result.message)).toHaveLength(1);
  expect(state.writes).toHaveLength(1);
});
it("reserves the default onboarding source slot before the profile exists", async () => {
  state.sourceLimit = 3; state.names = [{ name: "feed-1" }, { name: "feed-2" }];
  const form = new FormData(); form.set("catalogId", "dev-ai");
  expect(await addCommunitySource("ws", {}, form)).toMatchObject({ catalogId: "dev-ai", error: expect.any(String) });
  expect(state.writes).toHaveLength(0);
});
