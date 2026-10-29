import { NextResponse } from "next/server";

import { ingestReviewedSourcesUnderScanLease } from "@/lib/agents/discovery/apply";
import { reviewIngestedDocuments } from "@/lib/agents/review";
import { internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flags sources that keep returning irrelevant documents, for the owner to confirm (Workflow step: review). The scan
 * holds the workspace lease here, so it also creates approved sources an earlier ingest left waiting for the lease.
 */
export async function POST(req: Request) {
  return internalStep(req, "review", ["workspaceId"], async ({ workspaceId }) => {
    const review = await reviewIngestedDocuments(workspaceId);
    let sources: { ingested: string[]; waiting: string[] } = { ingested: [], waiting: [] };
    try {
      sources = await ingestReviewedSourcesUnderScanLease(workspaceId, req.signal);
    } catch {
      // Best effort: the proposals stay reviewed and the next scan tries again.
      console.error("[scan-review] reviewed source ingest skipped");
    }
    return NextResponse.json({ ...review, sources });
  });
}
