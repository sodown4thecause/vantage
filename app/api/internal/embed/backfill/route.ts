import { NextResponse } from "next/server";

import { internalStep } from "@/lib/cron/steps";
import { parseEmbedJob, runEmbedJob } from "@/lib/embeddings/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Embed queue consumer step: indexes one profile or the workspace's pending documents (IDs only). */
export async function POST(req: Request) {
  return internalStep(req, "embed-backfill", ["workspaceId"], async ({ workspaceId }, _signal, body) => {
    const job = parseEmbedJob(body);
    if (!job || job.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    const result = await runEmbedJob(job);
    if (result === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  });
}
