import { and, eq, sql } from "drizzle-orm";

import {
  classifyCollectorCoverage,
  documentsAreFixtureOnly,
  type SourceRunReceipt,
} from "@/lib/collectors/coverage";
import { fixturesAllowed } from "@/lib/collectors/provenance";
import { WEB_DISCUSSIONS_PROVIDER } from "@/lib/collectors/web-provider";
import type {
  Collector,
  CollectorResult,
  SourceType,
} from "@/lib/collectors/types";
import { getDb } from "@/lib/db/client";
import { document, source } from "@/lib/db/schema";
import { getSourceSwitch } from "@/lib/sources/switch";
import { scanIssuesFromError, summariseScanHealth, type ScanHealth, type ScanIssue } from "@/lib/scan/health";

export type RunCollectorInput = {
  collector: Collector;
  workspaceId: string;
  sourceId: string;
  signal?: AbortSignal;
};

export type RunCollectorOutput = {
  sourceId: string;
  collector: string;
  inserted: number;
  skipped: number;
  nextState?: CollectorResult["nextState"];
  receipt?: SourceRunReceipt;
  error?: string;
  scanHealth?: ScanHealth;
  /** Set when a global source switch stopped the run; nothing was fetched. */
  switchedOff?: { state: string; reason: string };
};

/**
 * Load a source row, run a collector, insert documents (deduped by content_hash),
 * and persist etag/cursor + a coverage receipt back onto the source.
 * Failures are isolated per source — callers may continue other sources.
 */
/**
 * Records why a source was skipped so scan status can report the real cause. Best effort, and deliberately leaves
 * `lastPolledAt` and the `lastRun` receipt alone: nothing was polled.
 */
async function recordSkippedScan(workspaceId: string, sourceId: string, scanHealth: ScanHealth): Promise<void> {
  try {
    const lastSkip = { ranAt: new Date().toISOString(), scanHealth };
    await getDb().update(source).set({ config: sql`${source.config} || ${JSON.stringify({ lastSkip })}::jsonb` })
      .where(and(eq(source.id, sourceId), eq(source.workspaceId, workspaceId)));
  } catch {
    console.error("[collector] could not record skipped scan", { sourceId });
  }
}

function skippedHealth(provider: string): ScanHealth {
  return summariseScanHealth({ discovered: 0, verified: 0, completed: false, cancelled: false,
    issues: [{ stage: "dispatch", kind: "provider_disabled", provider, retryable: false }] });
}

export async function runCollector(
  input: RunCollectorInput,
): Promise<RunCollectorOutput> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(source)
    .where(
      and(
        eq(source.id, input.sourceId),
        eq(source.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  if (!row) {
    return {
      sourceId: input.sourceId,
      collector: input.collector.name,
      inserted: 0,
      skipped: 0,
      error: `source ${input.sourceId} not found for workspace ${input.workspaceId}`,
    };
  }

  if (row.health === "paused") {
    const scanHealth = skippedHealth(input.collector.name);
    await recordSkippedScan(input.workspaceId, row.id, scanHealth);
    return { sourceId: row.id, collector: input.collector.name, inserted: 0, skipped: 0, scanHealth };
  }

  const switchDecision = await getSourceSwitch(row.type);
  if (!switchDecision.enabled) {
    const scanHealth = skippedHealth(input.collector.name);
    await recordSkippedScan(input.workspaceId, row.id, scanHealth);
    return {
      sourceId: row.id,
      collector: input.collector.name,
      inserted: 0,
      skipped: 0,
      switchedOff: { state: switchDecision.state, reason: switchDecision.reason },
      scanHealth,
    };
  }

  let inserted = 0;
  let skipped = 0;
  let scanHealth: ScanHealth | undefined;
  let stage: ScanIssue["stage"] = "dispatch";
  try {
    input.signal?.throwIfAborted();
    if (process.env.NODE_ENV === "production" && ["producthunt", "youtube"].includes(row.type)) {
      throw new Error("Access pending: this legacy collector needs a verified metered production adapter.");
    }
    if (process.env.NODE_ENV === "production" &&
        !(row.lane === "free" && ["hn", "rss", "substack", "github", "stackoverflow"].includes(row.type)) &&
        !(row.type === "reddit" && row.lane === "byok") &&
        !(row.type === "web_search" && row.lane === "byok" && (row.config as Record<string, unknown> | null)?.provider === WEB_DISCUSSIONS_PROVIDER) &&
        !(process.env.VANTAGE_PAID_PROVIDERS_ENABLED === "true" && ["reddit", "x", "web_search", "linkedin"].includes(row.type))) {
      throw new Error("Budget limited: this provider requires an explicit paid-provider opt-in.");
    }
    stage = "discovery";
    const result: CollectorResult = await input.collector.run({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      config: (row.config ?? {}) as Record<string, unknown>,
      signal: input.signal,
      etag: row.etag,
      lastModified: row.lastModified,
      cursor: row.cursor,
    });
    if (!fixturesAllowed() &&
        result.documents.some((doc) => documentsAreFixtureOnly([doc]))) {
      throw new Error("Access pending: synthetic provider output rejected; configure live access.");
    }
    scanHealth = result.scanHealth ?? summariseScanHealth({ discovered: result.documents.length,
      verified: result.documents.filter(doc => doc.metadata?.partial !== true && doc.metadata?.discoveryOnly !== true && doc.metadata?.contentKind !== "preview" && doc.metadata?.contentKind !== "page_excerpt" &&
        doc.metadata?.mocked !== true && doc.metadata?.provider !== "fixture" && Boolean(doc.contentMd?.trim())).length,
      completed: !result.partial && !result.documents.some(doc => doc.metadata?.partial === true), cancelled: false, issues: [] });
    stage = "persist";
    if (result.documents.length) {
      input.signal?.throwIfAborted();
      const rows = await db.insert(document).values(result.documents.map((doc) => ({
        ...doc, workspaceId: input.workspaceId, sourceId: input.sourceId,
      }))).onConflictDoNothing({ target: [document.workspaceId, document.contentHash] }).returning({ id: document.id });
      inserted = rows.length;
      skipped = result.documents.length - inserted;
    }

    const classified = classifyCollectorCoverage({
      documents: result.documents,
      partial: result.partial || scanHealth.state !== "complete",
      coverageReason: result.coverageReason,
      inserted,
      skipped,
    });
    const receipt: SourceRunReceipt = {
      ...classified,
      ranAt: new Date().toISOString(),
      scanHealth,
    };

    const next = result.nextState ?? {};
    await db
      .update(source)
      .set({
        etag: next.etag === undefined ? row.etag : next.etag,
        lastModified:
          next.lastModified === undefined ? row.lastModified : next.lastModified,
        cursor: next.cursor === undefined ? row.cursor : next.cursor,
        lastPolledAt: new Date(),
        health: receipt.health,
        config: sql`${source.config} || ${JSON.stringify({ lastRun: receipt })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(source.id, row.id));

    return {
      sourceId: input.sourceId,
      collector: input.collector.name,
      inserted,
      skipped,
      nextState: result.nextState,
      receipt,
      scanHealth,
    };
  } catch (err) {
    const issues = [...scanHealth?.issues ?? [], ...scanIssuesFromError(err, stage, input.collector.name)];
    scanHealth = summariseScanHealth({ discovered: scanHealth?.discovered ?? 0, verified: scanHealth?.verified ?? 0,
      completed: false, cancelled: input.signal?.aborted === true || issues.some(issue => issue.kind === "aborted"), issues });
    const message = err instanceof Error ? err.message : String(err);
    console.error("[collector] run failed", {
      collector: input.collector.name,
      sourceId: input.sourceId,
      workspaceId: input.workspaceId,
      error: message,
    });
    const classified = classifyCollectorCoverage({
      documents: [],
      inserted,
      skipped,
      error: message,
    });
    const receipt: SourceRunReceipt = {
      ...classified,
      ranAt: new Date().toISOString(),
      scanHealth,
    };
    try {
      const now = new Date();
      await db
        .update(source)
        .set({
          health: receipt.health,
          lastPolledAt: now,
          updatedAt: now,
          config: sql`${source.config} || ${JSON.stringify({ lastRun: receipt })}::jsonb`,
        })
        .where(eq(source.id, row.id));
    } catch (healthErr) {
      console.error("[collector] failed to persist source health", {
        collector: input.collector.name,
        sourceId: input.sourceId,
        error: healthErr instanceof Error ? healthErr.message : String(healthErr),
      });
    }
    return {
      sourceId: input.sourceId,
      collector: input.collector.name,
      inserted,
      skipped,
      receipt,
      scanHealth,
      error: message,
    };
  }
}

export async function runCollectorForType(opts: {
  collector: Collector;
  workspaceId: string;
  sourceType: SourceType;
  sourceId?: string;
  signal?: AbortSignal;
}): Promise<RunCollectorOutput[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(source)
    .where(
      and(
        eq(source.workspaceId, opts.workspaceId),
        eq(source.type, opts.sourceType),
      ),
    );

  const targets = opts.sourceId
    ? rows.filter((r) => r.id === opts.sourceId)
    : rows;

  if (!targets.length) {
    return [
      {
        sourceId: opts.sourceId ?? "",
        collector: opts.collector.name,
        inserted: 0,
        skipped: 0,
        error: `no ${opts.sourceType} sources for workspace`,
      },
    ];
  }

  const out: RunCollectorOutput[] = [];
  for (const t of targets) {
    out.push(
      await runCollector({
        collector: opts.collector,
        workspaceId: opts.workspaceId,
        sourceId: t.id,
        signal: opts.signal,
      }),
    );
  }
  return out;
}
