import { NextResponse } from "next/server";

import { internalStep, planScan } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Claims the scan lease and lists the sources to collect (Workflow step: plan). */
export async function POST(req: Request) {
  return internalStep(req, "plan", ["workspaceId"], async ({ workspaceId }) => {
    const plan = await planScan(workspaceId);
    if (plan.kind === "busy") return NextResponse.json({ error: "scan already running" }, { status: 409 });
    if (plan.kind === "skipped") return NextResponse.json({ skipped: true, reason: plan.reason });
    return NextResponse.json({ leaseToken: plan.leaseToken, sourceIds: plan.sourceIds });
  });
}
