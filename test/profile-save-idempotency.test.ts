import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { monitoringProfile, type MonitoringProfile } from "@/lib/db/schema";
import type { MonitoringProfileInput } from "@/lib/profile/types";

const state = vi.hoisted(() => ({
  reads: [] as unknown[][],
  latestReads: [] as unknown[][],
  predicates: [] as unknown[],
  inserts: [] as Record<string, unknown>[],
  conflictTargets: [] as unknown[],
  inserted: [] as unknown[],
  insertResults: [] as unknown[][],
  sourceWrites: 0,
  sourceFailures: 0,
  sourceValues: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  select: () => ({ from: () => ({ where: (predicate: unknown) => {
    state.predicates.push(predicate);
    return { limit: async () => state.reads.shift() ?? [], orderBy: () => ({ limit: async () => state.latestReads.shift() ?? [] }) };
  } }) }),
  insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => {
    if (table !== monitoringProfile) return { onConflictDoUpdate: async () => {
      state.sourceWrites++;
      state.sourceValues.push(values);
      if (state.sourceFailures > 0) {
        state.sourceFailures--;
        throw new Error("source setup failed");
      }
    } };
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
  state.sourceFailures = 0; state.sourceValues = [];
  state.latestReads = [];
  vi.mocked(retrieveProductMaterial).mockClear();
  vi.stubEnv("TINYFISH_API_KEY", ""); vi.stubEnv("SCAVIO_API_KEY", ""); vi.stubEnv("FIRECRAWL_API_KEY", "");
});

it("reuses a persisted profile without fetching and refreshes sources from its saved fields", async () => {
  state.reads = [[row]];
  expect(await saveMonitoringProfile({ workspaceId, input: { ...input, topics: ["different"] }, profileId: id })).toMatchObject({ id, version: 1 });
  expect(state.inserts).toHaveLength(0);
  expect(retrieveProductMaterial).not.toHaveBeenCalled();
  expect(state.sourceWrites).toBe(1);
  expect(state.sourceValues[0]).toMatchObject({ workspaceId, config: { queries: row.topics } });
  const query = new PgDialect().sqlToQuery(state.predicates[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(query.sql).toContain('"monitoring_profile"."workspace_id"');
  expect(query.sql).toContain('"monitoring_profile"."id"');
  expect(query.params).toEqual([workspaceId, id]);
});

it("uses the profile primary key to deduplicate concurrent saves and reloads within the workspace", async () => {
  state.reads = [[], [row]];
  const saved = await saveMonitoringProfile({ workspaceId, input, profileId: id });
  expect(saved).toMatchObject({ id, version: 1 });
  expect(state.inserts[0]).toMatchObject({ id, workspaceId, version: 1 });
  expect(state.conflictTargets).toEqual([monitoringProfile.id]);
  expect(state.sourceWrites).toBe(1);
  const query = new PgDialect().sqlToQuery(state.predicates[2] as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(query.params).toEqual([workspaceId, id]);
});

it("fails closed when a conflicting profile is not in this workspace", async () => {
  state.reads = [[], []];
  await expect(saveMonitoringProfile({ workspaceId, input, profileId: id })).rejects.toThrow("failed to persist monitoring profile");
  expect(state.sourceWrites).toBe(0);
});

it("does not replace newer source searches when recovering an older profile", async () => {
  state.reads = [[row]];
  state.latestReads = [[{ ...row, id: "newer-profile", version: 2, topics: ["newer search"] }]];
  await expect(saveMonitoringProfile({ workspaceId, input, profileId: id })).resolves.toMatchObject({ id, version: 1 });
  expect(state.sourceWrites).toBe(0);
  expect(state.inserts).toHaveLength(0);
  expect(retrieveProductMaterial).not.toHaveBeenCalled();
  const query = new PgDialect().sqlToQuery(state.predicates[1] as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(query.params).toEqual([workspaceId]);
});

it("creates only one profile and safely repeats source upserts across independent calls", async () => {
  state.reads = [[], []]; state.inserted = [row];
  expect(await saveMonitoringProfile({ workspaceId, input, profileId: id })).toMatchObject({ id });
  state.reads = [[row]];
  expect(await saveMonitoringProfile({ workspaceId, input, profileId: id })).toMatchObject({ id });
  expect(state.inserts).toHaveLength(1);
  expect(state.sourceWrites).toBe(2);
});

it("returns one profile and provisions sources when two requests race for the same persisted key", async () => {
  state.reads = [[], [], [row]];
  state.insertResults = [[row], []];
  const saved = await Promise.all([
    saveMonitoringProfile({ workspaceId, input, profileId: id }),
    saveMonitoringProfile({ workspaceId, input, profileId: id }),
  ]);
  expect(saved.map(profile => profile.id)).toEqual([id, id]);
  expect(state.conflictTargets).toEqual([monitoringProfile.id, monitoringProfile.id]);
  expect(state.sourceWrites).toBe(2);
});

it("retries failed source setup without creating another profile version or fetching again", async () => {
  state.reads = [[], []]; state.inserted = [row]; state.sourceFailures = 1;
  await expect(saveMonitoringProfile({ workspaceId, input, profileId: id })).rejects.toThrow("source setup failed");
  state.reads = [[row]];
  await expect(saveMonitoringProfile({ workspaceId, input, profileId: id })).resolves.toMatchObject({ id, version: 1 });
  expect(state.inserts).toHaveLength(1);
  expect(retrieveProductMaterial).toHaveBeenCalledTimes(1);
  expect(state.sourceWrites).toBe(2);
});

it("does not report success when source setup still fails on an existing profile", async () => {
  state.reads = [[row]]; state.sourceFailures = 1;
  await expect(saveMonitoringProfile({ workspaceId, input, profileId: id })).rejects.toThrow("source setup failed");
  expect(state.inserts).toHaveLength(0);
});

it("propagates source setup failure after loading a concurrent insert", async () => {
  state.reads = [[], [row]]; state.sourceFailures = 1;
  await expect(saveMonitoringProfile({ workspaceId, input, profileId: id })).rejects.toThrow("source setup failed");
  expect(state.sourceWrites).toBe(1);
});

it("preserves ordinary profile inserts without conflict suppression", async () => {
  state.reads = [[]]; state.inserted = [row];
  expect(await saveMonitoringProfile({ workspaceId, input })).toMatchObject({ id });
  expect(state.conflictTargets).toHaveLength(0);
  expect(state.inserts[0]).not.toHaveProperty("id");
});

it("leaves newer searches untouched when an old retry reloads after an insert conflict", async () => {
  const newer = { ...row, id: "new-profile", version: 2, topics: ["current searches"] };
  state.reads = [[], [row]];
  state.latestReads = [[newer], [newer]];
  await saveMonitoringProfile({ workspaceId, input, profileId: id });
  expect(state.sourceWrites).toBe(0);
});
