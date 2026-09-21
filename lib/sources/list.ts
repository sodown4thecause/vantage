import { eq } from "drizzle-orm";

import {
  readLastRunReceipt,
  type CoverageStatus,
  type SourceRunReceipt,
} from "@/lib/collectors/coverage";
import { collectorsByType } from "@/lib/collectors/registry";
import type { SourceType } from "@/lib/collectors/types";
import { getDb } from "@/lib/db/client";
import { source, type Source } from "@/lib/db/schema";

export type SourceCoverageView = {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  lane: string;
  health: string;
  coverage: CoverageStatus | null;
  lastPolledAt: string | null;
  lastRun: SourceRunReceipt | null;
  collectorRegistered: boolean;
  etag: string | null;
  cursor: string | null;
};

function toView(row: Source): SourceCoverageView {
  const config = (row.config ?? {}) as Record<string, unknown>;
  const lastRun = readLastRunReceipt(config);
  const type = row.type as SourceType;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    type: row.type,
    lane: row.lane,
    health: row.health,
    coverage: lastRun?.coverage ?? null,
    lastPolledAt: row.lastPolledAt ? row.lastPolledAt.toISOString() : null,
    lastRun,
    collectorRegistered: Boolean(collectorsByType[type]),
    etag: row.etag ?? null,
    cursor: row.cursor ?? null,
  };
}

export async function listWorkspaceSources(
  workspaceId: string,
): Promise<SourceCoverageView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(source)
    .where(eq(source.workspaceId, workspaceId));
  return rows
    .map(toView)
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}
