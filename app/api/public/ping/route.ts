import { NextResponse } from "next/server";

import { guardPublicRequest } from "@/lib/public/guard";

/** Guarded no-cost route used only to prove the public guard in tests/staging. */
export async function POST(req: Request) {
  const guard = await guardPublicRequest(req, {
    action: "ping",
    costEstimateUsd: 0,
    perVisitorPerDay: 20,
  });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.code }, { status: guard.status });
  }
  return NextResponse.json({ ok: true });
}
