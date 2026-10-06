import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import { collectorsByType } from "@/lib/collectors/registry";
import { runCollector } from "@/lib/collectors/run";
import { getDb } from "@/lib/db/client";
import { source } from "@/lib/db/schema";
import { buildOpportunities } from "@/lib/opportunities/run";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { withWorkspaceScanLease } from "@/lib/cron/lease";

export async function scanWorkspace(workspaceId: string, deadline?: AbortSignal) {
  return withWorkspaceScanLease(workspaceId, async (leaseSignal) => {
    const signal = deadline ? AbortSignal.any([deadline, leaseSignal]) : leaseSignal;
    const opportunityResults = [];
    if (!(await getLatestMonitoringProfile(workspaceId))) {
      return { collectorResults: [], opportunityResults: [{ workspaceId, skipped: true, reason: "monitoring profile required" }] };
    }
    const collectorResults = [];
    const db = getDb();
    const sources = await db
      .select()
      .from(source)
      .where(and(eq(source.workspaceId, workspaceId), eq(source.lane, "free"), ne(source.health, "paused"), inArray(source.type, ["hn", "rss", "substack"])))
      .orderBy(sql`${source.lastPolledAt} asc nulls first`, source.id).limit(9);

    if (sources.length > 8) collectorResults.push({ workspaceId, skipped: true, reason: "Additional eligible sources deferred to the next scan." });

    const workspaceCollectorResults = await mapWithConcurrency(
      sources.slice(0, 8),
      4,
      async (src) => {
        const collector = collectorsByType[src.type];
        if (!collector) {
          return {
            workspaceId: workspaceId,
            sourceId: src.id,
            type: src.type,
            skipped: true,
            reason: "no collector registered",
          };
        }
        try {
          const result = await runCollector({
            collector,
            workspaceId: workspaceId,
            sourceId: src.id,
            signal,
          });
          if (result.switchedOff) {
            return {
              workspaceId: workspaceId,
              sourceId: src.id,
              type: src.type,
              skipped: true,
              reason: "source paused",
            };
          }
          const { error, ...publicResult } = result;
          return {
            workspaceId: workspaceId,
            ...publicResult,
            type: src.type,
            ...(error ? { error: "collector failed" } : {}),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[tick] collector failed", src.id, message);
          return {
            workspaceId: workspaceId,
            sourceId: src.id,
            type: src.type,
            error: "collector failed",
            inserted: 0,
            skipped: 0,
            collector: collector.name,
          };
        }
      },
    );
    collectorResults.push(...workspaceCollectorResults);

    try {
      signal?.throwIfAborted();
      const result = await buildOpportunities({ workspaceId, limitDocs: 50, signal });
      opportunityResults.push({ workspaceId: workspaceId, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[tick] opportunity build failed", workspaceId, message);
      opportunityResults.push({ workspaceId: workspaceId, error: "opportunity build failed" });
    }
    return { collectorResults, opportunityResults };
  });
}
