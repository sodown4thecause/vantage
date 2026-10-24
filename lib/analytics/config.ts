/**
 * PostHog settings shared by the browser client and the server helper. NEXT_PUBLIC_* values are inlined at build
 * time, so they must be present where `pnpm cf:build` runs (the Deploy workflow), not only as runtime secrets.
 */

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/** The ingestion host (us.i.posthog.com or eu.i.posthog.com) without a trailing slash. */
export function posthogHost(): string {
  return (process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST).replace(/\/+$/, "");
}

/** The public project token (safe in the browser). Undefined disables all PostHog capture. */
export function posthogKey(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() || undefined;
}

/** Replay never records the sign-in and sign-up pages, where people type credentials and one-time codes. */
export function isReplayExcludedPath(pathname: string): boolean {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}
