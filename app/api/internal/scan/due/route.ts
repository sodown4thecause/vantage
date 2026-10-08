import { NextResponse } from "next/server";

import { dueWorkspaceIds, internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Workspaces whose scan cadence is due (Workflow step: find work). */
export async function POST(req: Request) {
  return internalStep(req, "due", [], async () => NextResponse.json({ workspaceIds: await dueWorkspaceIds() }));
}
