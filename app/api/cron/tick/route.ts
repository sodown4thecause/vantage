import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/cron/authorize";
import { runSweep } from "@/lib/cron/runSweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 3-hour sweep over every workspace: collectors, pipeline, then digests.
 * The cron entry point stays a Bearer-secret authenticated HTTP route; the
 * Cloudflare Cron Trigger invokes the same `runSweep()` through the Worker's
 * scheduled handler (see wrangler.jsonc -> triggers.crons).
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const result = await runSweep(workspaceId);

  return NextResponse.json(result, {
    status: result.ok ? 200 : 500,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
