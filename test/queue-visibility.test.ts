import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const state = vi.hoisted(() => ({
  version: 2,
  cardVersion: 2,
  metadata: {} as Record<string, unknown>,
  postedAt: new Date(),
  predicate: undefined as SQL | undefined,
}));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: async () => ({ version: state.version }) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: () => ({ from: () => ({
  where: (predicate: SQL) => { state.predicate = predicate; return { orderBy: () => ({ limit: async () => [{
    id: "op-1", workspaceId: "ws-1", features: { profileVersion: state.cardVersion },
    createdAt: new Date(), updatedAt: new Date(),
  }] }) }; },
  innerJoin: () => ({ where: async () => [{ doc: { metadata: state.metadata, postedAt: state.postedAt, collectedAt: new Date() } }] }),
}) }) }) }));
import { listOpportunityQueue } from "@/lib/opportunities/run";

it("hides stored cards with synthetic, expired, or obsolete-profile evidence", async () => {
  state.cardVersion = 1;
  expect(await listOpportunityQueue({ workspaceId: "ws-1" })).toHaveLength(0);
  state.cardVersion = 2;
  state.metadata = { provider: "fixture" };
  expect(await listOpportunityQueue({ workspaceId: "ws-1" })).toHaveLength(0);
  state.metadata = {};
  state.postedAt = new Date(Date.now() - 8 * 86400_000);
  expect(await listOpportunityQueue({ workspaceId: "ws-1" })).toHaveLength(0);
  state.postedAt = new Date();
  expect(await listOpportunityQueue({ workspaceId: "ws-1" })).toHaveLength(1);
});

it("applies live evidence eligibility in SQL before the five-card limit", async () => {
  await listOpportunityQueue({ workspaceId: "ws-1" });
  const query = new PgDialect().sqlToQuery(state.predicate!).sql;
  expect(query).toContain("exists (select 1");
  expect(query).toContain("not exists (select 1");
  expect(query).toContain("interval '7 days'");
  expect(query).toContain("is distinct from 'fixture'");
  expect(query).toContain("'mocked'");
  expect(query).toContain('"document"."workspace_id" <> "opportunity"."workspace_id"');
});
