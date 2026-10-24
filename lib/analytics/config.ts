/**
 * PostHog settings shared by next.config.ts (the reverse proxy rewrites), the browser client and the server client.
 * NEXT_PUBLIC_* values are inlined at build time, so they must be set where `pnpm cf:build` runs (the Deploy workflow),
 * not only as Cloudflare runtime secrets.
 */

/**
 * Same-origin path the browser sends events to; next.config.ts rewrites it to PostHog. Deliberately not /analytics,
 * /posthog or /ingest, which ad-block lists match.
 */
export const ANALYTICS_PROXY_PATH = "/lumen";

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/** The ingestion host (us.i.posthog.com or eu.i.posthog.com), without a trailing slash. */
export function posthogHost(): string {
  return (process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST).replace(/\/+$/, "");
}

/** Static assets (the toolbar and lazy-loaded extensions) live on the matching -assets host. */
export function posthogAssetsHost(host = posthogHost()): string {
  return host.replace(/^(https?:\/\/)(us|eu)\.i\.posthog\.com$/, "$1$2-assets.i.posthog.com");
}

/** The PostHog app, for links from the toolbar back to the project. */
export function posthogUiHost(host = posthogHost()): string {
  return host.replace(/^(https?:\/\/)(us|eu)\.i\.posthog\.com$/, "$1$2.posthog.com");
}

export function posthogKey(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() || undefined;
}
