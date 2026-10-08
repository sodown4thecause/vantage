import { NextResponse } from "next/server";

import { embedWorkspace, internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Best-effort semantic indexing; always 200 (Workflow step: embed). */
export async function POST(req: Request) {
  return internalStep(req, "embed", ["workspaceId"], async ({ workspaceId }, signal) =>
    NextResponse.json(await embedWorkspace(workspaceId, signal)));
}
