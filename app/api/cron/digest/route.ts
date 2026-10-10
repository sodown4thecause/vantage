import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/cron/authorize";
import { runDueDigests } from "@/lib/digest/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Digest-only cron entry for the Workflow path; the fallback tick dispatches its own digests. */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || !isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const digest = await runDueDigests();
    return NextResponse.json({ ok: true, digest });
  } catch (error) {
    console.error("[digest-cron] dispatch failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "digest dispatch failed" }, { status: 500 });
  }
}
