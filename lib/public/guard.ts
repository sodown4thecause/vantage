import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { reservePublicBudget, rowsOf, utcDay } from "@/lib/public/budget";

export type GuardOptions = {
  action: string;
  costEstimateUsd: number;
  perVisitorPerDay: number;
};

export type GuardErrorCode =
  | "turnstile_required"
  | "turnstile_failed"
  | "rate_limited"
  | "visitor_limit"
  | "budget_exhausted"
  | "guard_unavailable";

export type GuardResult =
  | { ok: true; visitorHash: string }
  | { ok: false; status: number; code: GuardErrorCode };

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const fail = (status: number, code: GuardErrorCode): GuardResult => ({
  ok: false,
  status,
  code,
});

type RateLimitBinding = { limit(opts: { key: string }): Promise<{ success: boolean }> };

/** The S02 rate-limit binding is optional: absent locally and until S02 lands. */
async function getRateLimiter(): Promise<RateLimitBinding | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    const binding = env.RADAR_LIMITER as RateLimitBinding | undefined;
    return binding && typeof binding.limit === "function" ? binding : null;
  } catch {
    return null;
  }
}

function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "unknown";
}

/** SHA-256(salt + day + ip). The raw IP is never stored or logged. */
export async function hashVisitor(ip: string, day: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${day}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyTurnstile(req: Request, ip: string, isProd: boolean): Promise<GuardResult | null> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    // Fail closed in production; skipped only for local/staging development.
    return isProd ? fail(503, "guard_unavailable") : null;
  }
  const token = req.headers.get("x-turnstile-token")?.trim();
  if (!token) return fail(403, "turnstile_required");
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
    if (!res.ok) return fail(503, "guard_unavailable");
    const json = (await res.json()) as { success?: boolean };
    return json.success === true ? null : fail(403, "turnstile_failed");
  } catch {
    return fail(503, "guard_unavailable");
  }
}

/**
 * Guard an unauthenticated, cost-bearing endpoint. Order: Turnstile, optional
 * Cloudflare rate-limit binding, per-visitor daily count, global dollar budget.
 * Every infrastructure failure fails closed with a stable, non-revealing code.
 */
export async function guardPublicRequest(
  req: Request,
  opts: GuardOptions,
): Promise<GuardResult> {
  const isProd = process.env.NODE_ENV === "production";
  try {
    const salt = process.env.VISITOR_SALT?.trim() || (isProd ? "" : "dev-visitor-salt");
    if (!salt) return fail(503, "guard_unavailable");

    const ip = clientIp(req);
    const day = utcDay();

    const turnstile = await verifyTurnstile(req, ip, isProd);
    if (turnstile) return turnstile;

    const visitorHash = await hashVisitor(ip, day, salt);

    const limiter = await getRateLimiter();
    if (limiter) {
      const { success } = await limiter.limit({ key: `${opts.action}:${visitorHash}` });
      if (!success) return fail(429, "rate_limited");
    }

    // Atomic: increments only while under the per-visitor daily limit.
    const visitor = await getDb().execute(sql`
      insert into public_visitor (visitor_hash, day, scans)
      select ${visitorHash}, ${day}::date, 1
      where ${opts.perVisitorPerDay}::int >= 1
      on conflict (visitor_hash, day) do update
        set scans = public_visitor.scans + 1
        where public_visitor.scans < ${opts.perVisitorPerDay}::int
      returning scans
    `);
    if (rowsOf(visitor).length === 0) return fail(429, "visitor_limit");

    if (!(await reservePublicBudget(opts.costEstimateUsd, { day }))) {
      return fail(503, "budget_exhausted");
    }
    return { ok: true, visitorHash };
  } catch (err) {
    console.error("[public/guard] failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(503, "guard_unavailable");
  }
}
