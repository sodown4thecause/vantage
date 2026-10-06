import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ values: [] as Record<string, unknown>[], conflicts: [] as unknown[] }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ insert: () => ({
  values: (value: Record<string, unknown>) => ({ onConflictDoUpdate: async (conflict: unknown) => {
    state.values.push(value); state.conflicts.push(conflict);
  } }),
}) }) }));
import { provisionProfileSources } from "@/lib/profile/repository";

it("provisions a bounded free HN source using the existing duplicate constraint", async () => {
  await provisionProfileSources("ws-1", ["agent evaluation", "benchmarks"]);
  expect(state.values[0]).toMatchObject({ workspaceId: "ws-1", type: "hn", lane: "free", config: {
    queries: ["agent evaluation", "benchmarks"], maxPages: 1, enrich: false,
  } });
  expect(state.conflicts).toHaveLength(1);
  expect(state.conflicts[0]).toHaveProperty("target");
});
