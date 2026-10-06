import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  assertValidUsd,
  reservePublicBudget,
  rowsOf,
  utcDay,
  type BudgetReservation,
} from "@/lib/public/budget";

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
  | "client_unidentified"
  | "guard_unavailable";

export type GuardResult =
  | { ok: true; visitorHash: string; reservation: BudgetReservation }
  | { ok: false; status: number; code: GuardErrorCode };

const SITEVERIFY_TIMEOUT_MS = 5_000;
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const fail = (status: number, code: GuardErrorCode): GuardResult => ({
  ok: false,
  status,
  code,
});

type RateLimitBinding = { limit(opts: { key: string }): Promise<{ success: boolean }> };

function isRateLimitBinding(value: unknown): value is RateLimitBinding {
  return typeof value === "object" && value !== null && "limit" in value && typeof value.limit === "function";
}

/** The S02 rate-limit binding is optional: absent locally and until S02 lands. */
async function getRateLimiter(): Promise<RateLimitBinding | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env: unknown = getCloudflareContext().env;
    const binding = typeof env === "object" && env !== null && "RADAR_LIMITER" in env ? env.RADAR_LIMITER : undefined;
    return isRateLimitBinding(binding) ? binding : null;
  } catch (err) {
    // Expected locally (no Cloudflare context); logged so a broken binding in
    // production is visible rather than silently unenforced.
    console.warn("[public/guard] rate-limit binding unavailable", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Cloudflare sets cf-connecting-ip and clients cannot forge it at the edge.
 * x-forwarded-for is client-controlled, so it is only honoured outside
 * production (local dev). Returns null when the client cannot be identified.
 */
function clientIp(req: Request, isProd: boolean): string | null {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  if (isProd) return null;
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "dev-local";
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
    // Skipping is an explicit non-production opt-in; otherwise fail closed.
    const bypass = !isProd && process.env.TURNSTILE_DEV_BYPASS === "true";
    return bypass ? null : fail(503, "guard_unavailable");
  }
  const token = req.headers.get("x-turnstile-token")?.trim();
  if (!token) return fail(403, "turnstile_required");
  try {
    const body = new URLSearchParams({ secret, response: token });
    body.set("remoteip", ip);
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return fail(503, "guard_unavailable");
    const json: unknown = await res.json();
    const success = typeof json === "object" && json !== null && "success" in json && json.success === true;
    return success ? null : fail(403, "turnstile_failed");
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

    assertValidUsd(opts.costEstimateUsd, "costEstimateUsd");
    if (!Number.isInteger(opts.perVisitorPerDay) || opts.perVisitorPerDay < 1) {
      throw new RangeError("perVisitorPerDay must be a positive integer");
    }

    const ip = clientIp(req, isProd);
    if (!ip) return fail(400, "client_unidentified");
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
      // The visitor did nothing wrong when the shared budget is spent, so give the allowance back.
      await getDb().execute(sql`
        update public_visitor set scans = greatest(scans - 1, 0)
        where visitor_hash = ${visitorHash} and day = ${day}::date
      `);
      return fail(503, "budget_exhausted");
    }
    return {
      ok: true,
      visitorHash,
      reservation: { day, estimateUsd: opts.costEstimateUsd },
    };
  } catch (err) {
    console.error("[public/guard] failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(503, "guard_unavailable");
  }
}
