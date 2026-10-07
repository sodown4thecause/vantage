import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import { collectorsByType } from "@/lib/collectors/registry";
import { runCollector } from "@/lib/collectors/run";
import { withWorkspaceScanLease } from "@/lib/cron/lease";
import { getDb } from "@/lib/db/client";
import { source } from "@/lib/db/schema";
import {
  FREE_SCAN_ESTIMATE_USD,
  FREE_SCAN_LABEL,
  FREE_SCAN_LIMITS,
  FREE_SCAN_SOURCE_TYPES,
} from "@/lib/lead-magnet/definition";
import {
  claimFreeScan,
  refundFreeScanBudget,
  releaseFreeScan,
  reserveFreeScanBudget,
  type BudgetClaim,
  type FreeScanCapResult,
} from "@/lib/lead-magnet/repository";
import { buildOpportunities, listOpportunityQueue } from "@/lib/opportunities/run";
import type { OpportunityCardView } from "@/lib/opportunities/types";

export type FreeScanSourceResult = {
  sourceId: string;
  type: string;
  name: string;
  inserted: number;
  skipped: number;
  skippedReason?: string;
};

export type FreeScanResult =
  | {
      ok: true;
      label: typeof FREE_SCAN_LABEL;
      scannedAt: string;
      sources: FreeScanSourceResult[];
      sourcesUsed: string[];
      documentsScanned: number;
      cards: OpportunityCardView[];
      message: string;
    }
  | {
      ok: false;
      label: typeof FREE_SCAN_LABEL;
      reason: "per_user_limit" | "budget_exhausted" | "already_running" | "no_sources" | "no_profile";
      message: string;
    };

/**
 * The free basic scan, end to end. Reuses the existing pipeline: collect each
 * eligible free-lane source with `runCollector`, then `buildOpportunities` and
 * `listOpportunityQueue`. No parallel pipeline.
 *
 * Bounds (see `lib/lead-magnet/definition.ts`): free-lane hn/rss/substack only,
 * max 8 sources, 50 documents, 1 scan per workspace per UTC day, and a global
 * daily dollar reservation. Callers must already have authorised the workspace.
 */
export async function runFreeScan(workspaceId: string): Promise<FreeScanResult> {
  const cap: FreeScanCapResult = await claimFreeScan(workspaceId);
  if (!cap.allowed) {
    return {
      ok: false,
      label: FREE_SCAN_LABEL,
      reason: "per_user_limit",
      message: "You have used today's free basic scan. We will keep watching — run again tomorrow.",
    };
  }

  const budget: BudgetClaim = await reserveFreeScanBudget(FREE_SCAN_ESTIMATE_USD);
  if (!budget.allowed) {
    await releaseFreeScan(workspaceId);
    return {
      ok: false,
      label: FREE_SCAN_LABEL,
      reason: "budget_exhausted",
      message: "Today's free scan budget is spent. Your scan is queued for tomorrow.",
    };
  }

  try {
    const result = await withWorkspaceScanLease(workspaceId, (signal) =>
      runFreeScanSteps(workspaceId, signal),
    );
    return result;
  } catch (err) {
    await refundFreeScanBudget(budget.reservation.day, budget.reservation.estimateUsd);
    await releaseFreeScan(workspaceId);
    if (err instanceof Error && err.message === "Workspace scan already running.") {
      return {
        ok: false,
        label: FREE_SCAN_LABEL,
        reason: "already_running",
        message: "A scan is already running for this workspace. Try again in a moment.",
      };
    }
    throw err;
  }
}

async function runFreeScanSteps(workspaceId: string, signal: AbortSignal): Promise<FreeScanResult> {
  const db = getDb();
  const sources = await db
    .select()
    .from(source)
    .where(
      and(
        eq(source.workspaceId, workspaceId),
        eq(source.lane, "free"),
        ne(source.health, "paused"),
        inArray(source.type, [...FREE_SCAN_SOURCE_TYPES]),
      ),
    )
    .orderBy(sql`${source.lastPolledAt} asc nulls first`, source.id)
    .limit(FREE_SCAN_LIMITS.maxSourcesPerScan);

  if (!sources.length) {
    return {
      ok: false,
      label: FREE_SCAN_LABEL,
      reason: "no_sources",
      message: "No free sources are configured yet. Save your profile to provision them, then scan.",
    };
  }

  const sourceResults = await mapWithConcurrency(sources, 4, async (src) => {
    const collector = collectorsByType[src.type];
    if (!collector) {
      return {
        sourceId: src.id,
        type: src.type,
        name: src.name,
        inserted: 0,
        skipped: 0,
        skippedReason: "no collector registered",
      } satisfies FreeScanSourceResult;
    }
    const out = await runCollector({ collector, workspaceId, sourceId: src.id, signal });
    return {
      sourceId: src.id,
      type: src.type,
      name: src.name,
      inserted: out.inserted,
      skipped: out.skipped,
      ...(out.switchedOff ? { skippedReason: out.switchedOff.reason } : {}),
    } satisfies FreeScanSourceResult;
  });

  const build = await buildOpportunities({
    workspaceId,
    limitDocs: FREE_SCAN_LIMITS.maxDocuments,
    signal,
  });
  const cards = await listOpportunityQueue({ workspaceId, limit: 5 });
  const sourcesUsed = [...new Set(sourceResults.map((r) => r.type))];

  return {
    ok: true,
    label: FREE_SCAN_LABEL,
    scannedAt: new Date().toISOString(),
    sources: sourceResults,
    sourcesUsed,
    documentsScanned: build.scanned,
    cards,
    message: cards.length
      ? `${FREE_SCAN_LABEL} complete: ${cards.length} ${cards.length === 1 ? "opportunity" : "opportunities"} from ${sourcesUsed.join(", ")}.`
      : "No strong opportunities yet — we'll keep watching and refresh your queue.",
  };
}
