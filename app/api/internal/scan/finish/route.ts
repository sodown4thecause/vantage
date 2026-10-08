import { NextResponse } from "next/server";

import { finishScan, internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Releases the scan lease held by leaseToken (Workflow step: finish). */
export async function POST(req: Request) {
  return internalStep(req, "finish", ["workspaceId", "leaseToken"], async ({ workspaceId, leaseToken }) => {
    await finishScan(workspaceId, leaseToken);
    return NextResponse.json({ released: true });
  });
}
