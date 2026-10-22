import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { monitoringProfile, type MonitoringProfile } from "@/lib/db/schema";
import type { MonitoringProfileInput } from "@/lib/profile/types";

const state = vi.hoisted(() => ({
  reads: [] as unknown[][],
  predicates: [] as unknown[],
  inserts: [] as Record<string, unknown>[],
  conflictTargets: [] as unknown[],
  inserted: [] as unknown[],
  insertResults: [] as unknown[][],
  sourceWrites: 0,
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  select: () => ({ from: () => ({ where: (predicate: unknown) => {
    state.predicates.push(predicate);
    return { limit: async () => state.reads.shift() ?? [], orderBy: () => ({ limit: async () => state.reads.shift() ?? [] }) };
  } }) }),
  insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => {
    if (table !== monitoringProfile) return { onConflictDoUpdate: async () => { state.sourceWrites++; } };
    state.inserts.push(values);
    const returning = async () => state.insertResults.shift() ?? state.inserted;
    return { returning, onConflictDoNothing: ({ target }: { target: unknown }) => {
      state.conflictTargets.push(target);
      return { returning };
    } };
  } }),
}) }));
vi.mock("@/lib/plans/limits", () => ({ assertWithinCount: vi.fn() }));
vi.mock("@/lib/profile/retrieve", () => ({ retrieveProductMaterial: vi.fn(async () => ({ status: "ok", text: "Site", notes: "" })) }));

import { saveMonitoringProfile } from "@/lib/profile/repository";
import { retrieveProductMaterial } from "@/lib/profile/retrieve";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const input: MonitoringProfileInput = {
  productUrl: "https://example.com/", docsUrls: [], productDescription: "Invoice tracking for tradies.",
  targetCustomer: "Tradies", competitors: ["A", "B", "C"], topics: ["invoices"],
};
const row: MonitoringProfile = {
  ...input, id, workspaceId, version: 1, productMaterialStatus: "ok", productMaterialText: "Site", retrievalNotes: "", createdAt: new Date(),
};

beforeEach(() => {
  state.reads = []; state.predicates = []; state.inserts = []; state.conflictTargets = []; state.inserted = []; state.insertResults = []; state.sourceWrites = 0;
  vi.mocked(retrieveProductMaterial).mockClear();
  vi.stubEnv("TINYFISH_API_KEY", ""); vi.stubEnv("SCAVIO_API_KEY", ""); vi.stubEnv("FIRECRAWL_API_KEY", "");
});

it("reuses a persisted profile without fetching or provisioning sources again", async () => {
  state.reads = [[row]];
  expect(await saveMonitoringProfile({ workspaceId, input, profileId: id })).toMatchObject({ id, version: 1 });
  expect(state.inserts).toHaveLength(0);
  expect(retrieveProductMaterial).not.toHaveBeenCalled();
  expect(state.sourceWrites).toBe(0);
  const query = new PgDialect().sqlToQuery(state.predicates[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(query.sql).toContain('"monitoring_profile"."workspace_id"');
  expect(query.sql).toContain('"monitoring_profile"."id"');
  expect(query.params).toEqual([workspaceId, id]);
});

it("uses the profile primary key to deduplicate concurrent saves and reloads within the workspace", async () => {
  state.reads = [[], [], [row]];
  const saved = await saveMonitoringProfile({ workspaceId, input, profileId: id });
  expect(saved).toMatchObject({ id, version: 1 });
  expect(state.inserts[0]).toMatchObject({ id, workspaceId, version: 1 });
  expect(state.conflictTargets).toEqual([monitoringProfile.id]);
  expect(state.sourceWrites).toBe(0);
  const query = new PgDialect().sqlToQuery(state.predicates[2] as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(query.params).toEqual([workspaceId, id]);
});

it("fails closed when a conflicting profile is not in this workspace", async () => {
  state.reads = [[], [], []];
  await expect(saveMonitoringProfile({ workspaceId, input, profileId: id })).rejects.toThrow("failed to persist monitoring profile");
  expect(state.sourceWrites).toBe(0);
});

it("creates and provisions only the first profile for an interview across independent calls", async () => {
  state.reads = [[], []]; state.inserted = [row];
  expect(await saveMonitoringProfile({ workspaceId, input, profileId: id })).toMatchObject({ id });
  state.reads = [[row]];
  expect(await saveMonitoringProfile({ workspaceId, input, profileId: id })).toMatchObject({ id });
  expect(state.inserts).toHaveLength(1);
  expect(state.sourceWrites).toBe(1);
});

it("returns one profile and provisions once when two requests race for the same persisted key", async () => {
  state.reads = [[], [], [], [], [row]];
  state.insertResults = [[row], []];
  const saved = await Promise.all([
    saveMonitoringProfile({ workspaceId, input, profileId: id }),
    saveMonitoringProfile({ workspaceId, input, profileId: id }),
  ]);
  expect(saved.map(profile => profile.id)).toEqual([id, id]);
  expect(state.conflictTargets).toEqual([monitoringProfile.id, monitoringProfile.id]);
  expect(state.sourceWrites).toBe(1);
});

it("preserves ordinary profile inserts without conflict suppression", async () => {
  state.reads = [[]]; state.inserted = [row];
  expect(await saveMonitoringProfile({ workspaceId, input })).toMatchObject({ id });
  expect(state.conflictTargets).toHaveLength(0);
  expect(state.inserts[0]).not.toHaveProperty("id");
});
