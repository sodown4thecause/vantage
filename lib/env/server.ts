import { optionalEnv } from "@/lib/env/required";

/**
 * Typed accessors for the optional runtime variables that need a default or
 * a documented fallback. Required variables keep using `requiredEnv`
 * directly at their call site so the build never needs them at import time.
 */

/** Resend credential for the daily digest; digests skip when unset. */
export function resendApiKey(): string | undefined {
  return optionalEnv("RESEND_API_KEY");
}

export function digestFromAddress(): string {
  return optionalEnv("DIGEST_FROM_ADDRESS") ?? "digest@contextfor.dev";
}

export function digestFromName(): string {
  return optionalEnv("DIGEST_FROM_NAME") ?? "Vantage";
}
