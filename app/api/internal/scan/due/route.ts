import { NextResponse } from "next/server";

import { dueWorkspaceIds, internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Workspaces whose scan cadence is due (Workflow step: find work). */
export async function POST(req: Request) {
  return internalStep(req, "due", [], async () => {
    try {
      return NextResponse.json({ workspaceIds: await dueWorkspaceIds() });
    } catch (error) {
      // internalStep drops the exception. Log the class only: Neon messages can carry SQL.
      console.error("[scan-due] lookup failed", error instanceof Error ? error.name : "unknown");
      throw error;
    }
  });
}
