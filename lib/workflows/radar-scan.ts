import { WorkflowEntrypoint } from "cloudflare:workers";
import type { Workflow, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import { scanWorkspace } from "@/lib/cron/scan";
import { rollupRecent } from "@/lib/costs/rollup";

/** Params accepted by `RADAR_SCAN.create(...)`. Keep JSON-serializable. */
export type RadarScanParams = {
  workspaceId: string;
  enforceCadence?: boolean;
};

/** Minimal Env surface this module references. Extend as bindings are added. */
export type RadarScanEnv = {
  RADAR_SCAN: Workflow<RadarScanParams>;
};

/**
 * A small, JSON-serializable digest of a scan run. The workflow step must not
 * return the full collector/opportunity payloads (they can approach the 1 MiB
 * step-result ceiling); callers only need counts and per-run skip/error labels.
 */
export type ScanRunSummary = {
  workspaceId: string;
  status: "ran" | "skipped" | "failed";
  reason?: string;
  collectors: { ran: number; skipped: number; errors: number };
  opportunities: { built: number; skipped: number; errors: number };
};

/**
 * Collapse raw `scanWorkspace` results into the tiny summary the workflow step
 * is allowed to persist. Pure so it can be unit-tested without the runtime.
 */
export function summarizeScan(
  workspaceId: string,
  result: { collectorResults: Array<Record<string, unknown>>; opportunityResults: Array<Record<string, unknown>> },
): ScanRunSummary {
  const collectors = { ran: 0, skipped: 0, errors: 0 };
  for (const entry of result.collectorResults) {
    if (entry.error) collectors.errors += 1;
    else if (entry.skipped) collectors.skipped += 1;
    else collectors.ran += 1;
  }

  const opportunities = { built: 0, skipped: 0, errors: 0 };
  for (const entry of result.opportunityResults) {
    if (entry.error) opportunities.errors += 1;
    else if (entry.skipped) opportunities.skipped += 1;
    else opportunities.built += 1;
  }

  // A lease/cadence skip surfaces as a single skipped opportunity with a reason.
  const skipReason = result.opportunityResults.find((entry) => entry.skipped && entry.reason)?.reason;
  if (skipReason && result.collectorResults.length === 0) {
    return { workspaceId, status: "skipped", reason: String(skipReason), collectors, opportunities };
  }

  const failed = collectors.errors > 0 || opportunities.errors > 0;
  return { workspaceId, status: failed ? "failed" : "ran", collectors, opportunities };
}

/**
 * Durable orchestration for one workspace scan. A thin, retryable wrapper: it
 * owns no scan logic itself, it just drives the existing `scanWorkspace` and
 * `rollupRecent` through Cloudflare Workflow steps so a crash mid-scan is
 * retried without re-entering the cron tick.
 */
export class RadarScanWorkflow extends WorkflowEntrypoint<RadarScanEnv, RadarScanParams> {
  async run(event: WorkflowEvent<RadarScanParams>, step: WorkflowStep): Promise<ScanRunSummary> {
    // `step.do` results must be JSON-serializable, so steps return the summary,
    // never the underlying collector/opportunity documents.
    const summary = await step.do(
      "scan-workspace",
      {
        retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
        timeout: "3 minutes",
      },
      async () => summarizeScan(event.payload.workspaceId, await scanWorkspace(event.payload.workspaceId, undefined, { enforceCadence: event.payload.enforceCadence })),
    );

    // A missing monitoring profile is an expected skip, not a failure: the
    // scan step reports it as a status and the workflow ends cleanly.
    if (summary.status === "skipped") return summary;

    await step.do("rollup-costs", { retries: { limit: 1, delay: "10 seconds" } }, async () => {
      // rollupRecent is best-effort and never throws.
      await rollupRecent();
      return { ok: true } as const;
    });

    return summary;
  }
}

/** True only for an env object that really exposes the `RADAR_SCAN` workflow binding. */
export function isRadarScanEnv(env: unknown): env is RadarScanEnv {
  if (typeof env !== "object" || env === null) return false;
  const binding = (env as { RADAR_SCAN?: unknown }).RADAR_SCAN;
  return typeof binding === "object" && binding !== null && typeof (binding as { create?: unknown }).create === "function";
}

/**
 * Enqueue one durable scan. `create` returns an instance id we surface to the
 * caller so a trigger response can be traced back to the Workflow instance.
 */
export async function enqueueRadarScan(env: RadarScanEnv, params: RadarScanParams): Promise<string> {
  if (!isRadarScanEnv(env)) {
    throw new Error("RADAR_SCAN workflow binding is missing; add it to wrangler.jsonc.");
  }
  const instance = await env.RADAR_SCAN.create({ params });
  return instance.id;
}
