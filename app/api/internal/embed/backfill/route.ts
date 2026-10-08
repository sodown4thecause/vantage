import { NextResponse } from "next/server";

import { internalStep } from "@/lib/cron/steps";
import { parseEmbedJob, runEmbedJob } from "@/lib/embeddings/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Embed queue consumer step: indexes one profile or the workspace's pending documents (IDs only). */
export async function POST(req: Request) {
  return internalStep(req, "embed-backfill", ["workspaceId"], async ({ workspaceId }, signal, body) => {
    const job = parseEmbedJob(body);
    if (!job || job.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    const result = await runEmbedJob(job, signal);
    if (result === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Retryable: the queue re-delivers on 5xx, so a transient embedding or Vectorize outage is not acknowledged.
    if (result.skipped === "unavailable") {
      return NextResponse.json({ error: "embedding unavailable" }, { status: 503 });
    }
    return NextResponse.json(result);
  });
}
