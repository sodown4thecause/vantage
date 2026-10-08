import { NextResponse } from "next/server";

import { buildWorkspace, internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Refreshes the opportunity queue (Workflow step: build). */
export async function POST(req: Request) {
  return internalStep(req, "build", ["workspaceId"], async ({ workspaceId }, signal) =>
    NextResponse.json(await buildWorkspace(workspaceId, signal)));
}
