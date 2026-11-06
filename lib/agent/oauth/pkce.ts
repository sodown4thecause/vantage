import { base64Url, timingSafeEqual } from "@/lib/agent/crypto";

/** RFC 7636 verifier/challenge alphabet and length. */
const PKCE_VALUE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && PKCE_VALUE.test(value);
}

export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && PKCE_VALUE.test(value);
}

/** S256 only. The "plain" method is never accepted, so a stolen code is useless alone. */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!isValidCodeVerifier(verifier)) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return timingSafeEqual(base64Url(new Uint8Array(digest)), challenge);
}
