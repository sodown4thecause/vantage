import { NextResponse } from "next/server";

export type RateLimitRule = {
  /** Requests allowed per key inside windowMs. */
  limit: number;
  windowMs: number;
};

/** Default budget for authenticated manual collection runs, per workspace. */
export const MANUAL_ENDPOINT_RULE: RateLimitRule = {
  limit: 30,
  windowMs: 60_000,
};

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

/**
 * Fixed-window limiter. Per-isolate and best-effort: it stops runaway loops
 * from a single caller inside one isolate, while Cloudflare WAF/Rate-Limiting
 * rules remain the durable, account-wide layer.
 */
export function checkRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): RateLimitDecision {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      pruneExpired(now);
    }
    if (buckets.size >= MAX_TRACKED_KEYS) {
      buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true };
  }

  if (existing.count >= rule.limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { ok: true };
}

/** 429 response carrying a positive Retry-After header. */
export function rateLimitResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "rate limit exceeded" },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
    },
  );
}
