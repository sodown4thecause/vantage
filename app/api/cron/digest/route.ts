import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/cron/authorize";
import { runDueDigests } from "@/lib/digest/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Workspace-scoped digest entry called after each scan Workflow builds its queue. */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || !isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body: unknown = await req.json().catch(() => null);
    const workspaceId = body && typeof body === "object" && "workspaceId" in body
      ? body.workspaceId
      : undefined;
    if (typeof workspaceId !== "string" || !workspaceId.trim()) {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }

    const digest = await runDueDigests(new Date(), workspaceId.trim());
    return NextResponse.json({ ok: digest.failed === 0, digest }, {
      status: digest.failed === 0 ? 200 : 503,
    });
  } catch (error) {
    console.error("[digest-cron] dispatch failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "digest dispatch failed" }, { status: 500 });
  }
}
