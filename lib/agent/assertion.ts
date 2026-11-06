import { base64Url, fromBase64Url, timingSafeEqual } from "@/lib/agent/crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type AssertionPayload = {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  scope: string;
  typ: "agent_identity";
};

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Compact JWS (HS256). The raw assertion is returned once and never stored. */
export async function signAssertion(payload: AssertionPayload, secret: string): Promise<string> {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${base64Url(new Uint8Array(signature))}`;
}

/**
 * Verifies signature, issuer, audience, type and expiry. Returns null for any
 * failure so callers cannot distinguish a forged token from an expired one.
 */
export async function verifyAssertion(
  token: string,
  secret: string,
  opts: { issuer: string; audience: string; now: Date },
): Promise<AssertionPayload | null> {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];

  const expected = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`${header}.${body}`));
  if (!timingSafeEqual(base64Url(new Uint8Array(expected)), signature)) return null;

  let payload: AssertionPayload;
  try {
    payload = JSON.parse(decoder.decode(fromBase64Url(body))) as AssertionPayload;
  } catch {
    return null;
  }
  if (payload?.typ !== "agent_identity") return null;
  if (payload.iss !== opts.issuer || payload.aud !== opts.audience) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1_000 <= opts.now.getTime()) return null;
  if (typeof payload.iat !== "number" || payload.iat * 1_000 > opts.now.getTime() + 60_000) return null;
  return payload;
}
