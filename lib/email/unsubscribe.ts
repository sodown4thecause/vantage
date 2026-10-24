import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const DAY_SECONDS = 86400;
const TOKEN_LIFETIME_SECONDS = 30 * DAY_SECONDS;
const payloadSchema = z.object({ w: z.uuid(), exp: z.number().int().positive(), v: z.literal(1) });

function signature(payload: string): Buffer {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new Error("Product email signing is unavailable");
  return createHmac("sha256", secret).update(`vantage/product-email/unsubscribe/v1:${payload}`).digest();
}

/** Counted from the UTC day of issue, so a retried send on the same day repeats its body for the provider's idempotency key. */
export function unsubscribeToken(workspaceId: string, now = Date.now()): string {
  const issuedDay = Math.floor(now / 1000 / DAY_SECONDS) * DAY_SECONDS;
  const payload = Buffer.from(JSON.stringify({ w: workspaceId, exp: issuedDay + TOKEN_LIFETIME_SECONDS, v: 1 })).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifyUnsubscribeToken(token: string, now = Date.now()): string | null {
  if (token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const [payload, mac] = token.split(".");
    const expected = signature(payload);
    const supplied = Buffer.from(mac, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    const seconds = Math.floor(now / 1000);
    if (!parsed.success || parsed.data.exp <= seconds || parsed.data.exp > seconds + TOKEN_LIFETIME_SECONDS) return null;
    return parsed.data.w;
  } catch {
    return null;
  }
}
