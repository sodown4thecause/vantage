const encoder = new TextEncoder();

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** A prefixed, URL-safe random token. The prefix makes leaked values identifiable in logs. */
export function randomToken(prefix: string, byteLength = 32): string {
  return `${prefix}_${base64Url(crypto.getRandomValues(new Uint8Array(byteLength)))}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Tokens and codes are stored as SHA-256(pepper + value). The pepper is a
 * secret, so a database leak alone cannot be turned into working credentials.
 */
export async function hashSecret(value: string, pepper: string): Promise<string> {
  return sha256Hex(`${pepper}:${value}`);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** Six digits from a CSPRNG, rejection-sampled so every code is equally likely. */
export function randomUserCode(): string {
  const buffer = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  let value = limit;
  while (value >= limit) {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  }
  return String(value % 1_000_000).padStart(6, "0");
}
