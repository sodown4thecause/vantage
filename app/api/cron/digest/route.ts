import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/cron/authorize";
import { runDueDigests } from "@/lib/digest/dispatch";
import { runAgentCleanup } from "@/lib/agent/registration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Digest-only cron entry for the Workflow path; the fallback tick dispatches its own digests.
 *
 * Authorization: `isCronAuthorized` below is the gate, and it refuses before any
 * write. `authorizeWorkspace` cannot apply to a cron sweep, which has no session
 * and no single workspace; the agent cleanup is scoped by construction to agent
 * registrations and the unowned workspaces they created.
 */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || !isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Best effort: an expired-trial cleanup failure must not stop digests.
    let agentCleanup: Awaited<ReturnType<typeof runAgentCleanup>> | null = null;
    try {
      agentCleanup = await runAgentCleanup();
    } catch (error) {
      console.error(
        "[digest-cron] agent cleanup failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    const digest = await runDueDigests();
    return NextResponse.json({ ok: true, digest, agentCleanup });
  } catch (error) {
    console.error("[digest-cron] dispatch failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "digest dispatch failed" }, { status: 500 });
  }
}
