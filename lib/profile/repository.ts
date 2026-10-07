import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  monitoringProfile,
  source,
  type MonitoringProfile,
} from "@/lib/db/schema";
import { assertWithinCount } from "@/lib/plans/limits";
import { retrieveProductMaterial } from "@/lib/profile/retrieve";
import type {
  MonitoringProfileInput,
  MonitoringProfileView,
} from "@/lib/profile/types";

export function toProfileView(row: MonitoringProfile): MonitoringProfileView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    version: row.version,
    productUrl: row.productUrl,
    docsUrls: row.docsUrls ?? [],
    productDescription: row.productDescription,
    targetCustomer: row.targetCustomer,
    competitors: row.competitors ?? [],
    topics: row.topics ?? [],
    productMaterialStatus: row.productMaterialStatus,
    productMaterialText: row.productMaterialText ?? "",
    retrievalNotes: row.retrievalNotes ?? "",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getLatestMonitoringProfile(
  workspaceId: string,
): Promise<MonitoringProfileView | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(monitoringProfile)
    .where(eq(monitoringProfile.workspaceId, workspaceId))
    .orderBy(desc(monitoringProfile.version))
    .limit(1);
  const row = rows[0];
  return row ? toProfileView(row) : null;
}

export async function getMonitoringProfileVersion(
  workspaceId: string,
  version: number,
): Promise<MonitoringProfileView | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(monitoringProfile)
    .where(
      and(
        eq(monitoringProfile.workspaceId, workspaceId),
        eq(monitoringProfile.version, version),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toProfileView(row) : null;
}

/**
 * Append a new profile version for the workspace after retrieving material.
 */
export async function saveMonitoringProfile(args: {
  workspaceId: string;
  input: MonitoringProfileInput;
  fetchImpl?: typeof fetch;
}): Promise<MonitoringProfileView> {
  const db = getDb();
  const latest = await getLatestMonitoringProfile(args.workspaceId);
  // Plan keyword cap. Profiles saved before plans existed are grandfathered: a save may keep
  // (but not grow) the keyword count the workspace already has. Throws PlanLimitError.
  await assertWithinCount(args.workspaceId, "keywords", 0, args.input.topics.length, latest?.topics.length ?? 0);
  const nextVersion = (latest?.version ?? 0) + 1;

  const material = await retrieveProductMaterial(
    args.input,
    args.fetchImpl ?? fetch,
  );

  const inserted = await db
    .insert(monitoringProfile)
    .values({
      workspaceId: args.workspaceId,
      version: nextVersion,
      productUrl: args.input.productUrl,
      docsUrls: args.input.docsUrls,
      productDescription: args.input.productDescription,
      targetCustomer: args.input.targetCustomer,
      competitors: args.input.competitors,
      topics: args.input.topics,
      productMaterialStatus: material.status,
      productMaterialText: material.text,
      retrievalNotes: material.notes,
    })
    .returning();

  const row = inserted[0];
  if (!row) {
    throw new Error("failed to persist monitoring profile");
  }
  await provisionProfileSources(args.workspaceId, args.input.topics);
  return toProfileView(row);
}

export const PROFILE_SOURCE_NAME = "Profile: Hacker News";

export async function provisionProfileSources(workspaceId: string, topics: string[]): Promise<void> {
  const config = { queries: topics.slice(0, 5), maxPages: 1, enrich: false };
  await getDb().insert(source).values({
    workspaceId, name: PROFILE_SOURCE_NAME, type: "hn", lane: "free", config,
  }).onConflictDoUpdate({
    target: [source.workspaceId, source.name],
    set: { config: sql`${source.config} || ${JSON.stringify(config)}::jsonb`, updatedAt: new Date() },
  });
}
