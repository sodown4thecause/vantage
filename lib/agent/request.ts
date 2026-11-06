import { utcDay } from "@/lib/public/budget";
import { clientIp, getRateLimiter, hashVisitor } from "@/lib/public/guard";

/**
 * Hashed client IP for rate limiting and audit. The raw address is never stored
 * or logged. Null means the client could not be identified.
 */
export async function agentIpHash(req: Request): Promise<string | null> {
  const ip = clientIp(req, process.env.NODE_ENV === "production");
  if (!ip) return null;
  const salt =
    process.env.VISITOR_SALT?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "dev-visitor-salt");
  if (!salt) return null;
  return hashVisitor(ip, utcDay(), salt);
}

/**
 * Cloudflare rate limit, keyed by action and caller. The binding is absent
 * locally, so a missing binding skips the check rather than blocking every
 * request; durable database caps are the backstop.
 */
export async function agentRateLimit(action: string, key: string): Promise<boolean> {
  const limiter = await getRateLimiter();
  if (!limiter) return true;
  const { success } = await limiter.limit({ key: `${action}:${key}` });
  return success;
}
