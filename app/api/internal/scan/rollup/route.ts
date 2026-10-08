import { NextResponse } from "next/server";

import { rollupRecent } from "@/lib/costs/rollup";
import { internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daily cost rollup, triggered by the Workflow scheduled path (the tick route runs it too). Never fails the caller. */
export async function POST(req: Request) {
  return internalStep(req, "rollup", [], async () => {
    await rollupRecent();
    return NextResponse.json({ ok: true });
  });
}
