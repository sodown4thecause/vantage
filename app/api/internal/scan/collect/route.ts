import { NextResponse } from "next/server";

import { collectSource, internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Collects one source; 502 on collector error so the Workflow step retries (Workflow step: collect). */
export async function POST(req: Request) {
  return internalStep(req, "collect", ["workspaceId", "sourceId"], async ({ workspaceId, sourceId }, signal) => {
    const outcome = await collectSource({ workspaceId, sourceId, signal });
    if (outcome.kind === "not_found") return NextResponse.json({ error: "source not found" }, { status: 404 });
    if (outcome.kind === "failed") return NextResponse.json({ error: "collector failed" }, { status: 502 });
    return NextResponse.json(outcome.body);
  });
}
