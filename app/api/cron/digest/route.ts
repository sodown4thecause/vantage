import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/cron/authorize";
import { runDueDigests } from "@/lib/digest/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Digest entry for both digest paths. A body naming a `workspaceId` scopes the dispatch
 * to that workspace and is what a scan Workflow step sends. An empty body runs the due
 * sweep for workspaces with no scan in flight, so delivery never depends on scan cadence.
 */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || !isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body: unknown = await req.json().catch(() => null);
    const requested = body && typeof body === "object" && "workspaceId" in body
      ? (body as { workspaceId: unknown }).workspaceId
      : undefined;
    if (requested !== undefined && (typeof requested !== "string" || !requested.trim())) {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }

    const workspaceId = typeof requested === "string" ? requested.trim() : undefined;
    const digest = await runDueDigests(new Date(), workspaceId, {
      skipActiveScans: workspaceId === undefined,
    });
    return NextResponse.json({ ok: digest.failed === 0, digest }, {
      status: digest.failed === 0 ? 200 : 503,
    });
  } catch (error) {
    console.error("[digest-cron] dispatch failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "digest dispatch failed" }, { status: 500 });
  }
}
