import { eq } from "drizzle-orm";

import {
  readLastRunReceipt,
  pausedGlobalLabel,
  type CoverageStatus,
  type DisplayCoverage,
  type SourceRunReceipt,
} from "@/lib/collectors/coverage";
import { collectorsByType } from "@/lib/collectors/registry";
import type { SourceType } from "@/lib/collectors/types";
import { getDb } from "@/lib/db/client";
import { source, type Source } from "@/lib/db/schema";
import { listOffSwitches, type SwitchDecision } from "@/lib/sources/switch";

export type SourceCoverageView = {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  lane: string;
  health: string;
  coverage: CoverageStatus | null;
  /** Coverage to show: "paused_global" when the operator switched this type off. */
  displayCoverage: DisplayCoverage | null;
  /** "Paused by operator: <reason>" when switched off, else null. */
  pausedLabel: string | null;
  lastPolledAt: string | null;
  lastRun: SourceRunReceipt | null;
  collectorRegistered: boolean;
  etag: string | null;
  cursor: string | null;
};

function toView(row: Source, off?: SwitchDecision): SourceCoverageView {
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
    displayCoverage: off ? "paused_global" : (lastRun?.coverage ?? null),
    pausedLabel: off ? pausedGlobalLabel(off.reason) : null,
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
  const off = await listOffSwitches();
  return rows
    .map((row) => toView(row, off.get(row.type)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}
