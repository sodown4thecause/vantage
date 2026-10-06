import { NextResponse } from "next/server";

import { guardPublicRequest } from "@/lib/public/guard";

/** Guarded no-cost route used only to prove the public guard in tests/staging. */
export async function POST(req: Request) {
  // Test-only and fail closed: 404 unless ENABLE_PUBLIC_PING is exactly "true". NODE_ENV cannot be the gate
  // because staging is also a production Next build; set the flag only on staging and in tests, never in production.
  if (process.env.ENABLE_PUBLIC_PING !== "true") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
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
