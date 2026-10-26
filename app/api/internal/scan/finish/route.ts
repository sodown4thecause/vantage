import { NextResponse } from "next/server";

import { finishScan, internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Releases the scan lease held by leaseToken (Workflow step: finish). */
export async function POST(req: Request) {
  return internalStep(req, "finish", ["workspaceId", "leaseToken"], async ({ workspaceId, leaseToken }, _signal, body) => {
    const summary = body && typeof body === "object" ? body as Record<string, unknown> : {};
    await finishScan(workspaceId, leaseToken, {
      read: typeof summary.read === "number" ? summary.read : undefined,
      relevant: typeof summary.relevant === "number" ? summary.relevant : undefined,
      picked: typeof summary.picked === "number" ? summary.picked : undefined,
      capped: summary.capped === true,
    });
    return NextResponse.json({ released: true });
  });
}
