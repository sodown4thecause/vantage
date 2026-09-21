import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  monitoringProfile,
  type MonitoringProfile,
} from "@/lib/db/schema";
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
  return toProfileView(row);
}
