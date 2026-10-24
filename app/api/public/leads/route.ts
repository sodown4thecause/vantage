import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db/client";
import { publicProductLead } from "@/lib/db/schema";
import { guardPublicRequest } from "@/lib/public/guard";
import { approvedHeroExamples } from "@/lib/public/hero-examples";

const leadInput = z.object({
  email: z.string().trim().max(254).email().transform((value) => value.toLowerCase()),
  product: z.string().trim().min(3).max(2000),
});

export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) {
    return NextResponse.json({ error: "request_not_allowed" }, { status: 403 });
  }
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "invalid_input" }, { status: 415 });
  }
  let input: z.infer<typeof leadInput>;
  try {
    const body = await req.text();
    if (new TextEncoder().encode(body).length > 12_000) {
      return NextResponse.json({ error: "invalid_input" }, { status: 413 });
    }
    const parsed = leadInput.safeParse(JSON.parse(body));
    if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (!req.headers.get("x-turnstile-token")?.trim()) {
    return NextResponse.json({ error: "turnstile_required" }, { status: 403 });
  }
  if (!process.env.TURNSTILE_SECRET_KEY?.trim()) {
    return NextResponse.json({ error: "guard_unavailable" }, { status: 503 });
  }
  const guard = await guardPublicRequest(req, {
    action: "product_lead",
    costEstimateUsd: 0,
    perVisitorPerDay: 5,
  });
  if (!guard.ok) return NextResponse.json({ error: guard.code }, { status: guard.status });
  try {
    await getDb().insert(publicProductLead).values({
      email: input.email,
      productDescription: input.product,
    }).onConflictDoNothing({ target: publicProductLead.email });
    const examples = await approvedHeroExamples();
    return NextResponse.json({ ok: true, examples }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "capture_unavailable" }, { status: 503 });
  }
}
