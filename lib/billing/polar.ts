import { createPolar } from "@polar-sh/sdk/2026-10";

import type { BillingServer } from "@/lib/billing/products";

export type PolarClient = ReturnType<typeof createPolar>;

/**
 * Polar environment from `POLAR_SERVER`. Anything other than exactly "production" is the
 * sandbox, so a missing or mistyped value can never charge real cards.
 */
export function billingServer(env: Record<string, string | undefined> = process.env): BillingServer {
  return env.POLAR_SERVER?.trim() === "production" ? "production" : "sandbox";
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super("Billing is not configured.");
    this.name = "BillingNotConfiguredError";
  }
}

/**
 * Polar client for the configured server. Built per call so the build and module scope never
 * need `POLAR_ACCESS_TOKEN` (an organization access token; keep it server-side only).
 */
export function getPolar(env: Record<string, string | undefined> = process.env): PolarClient {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new BillingNotConfiguredError();
  return createPolar({ accessToken, environment: billingServer(env), timeout: 20 });
}
