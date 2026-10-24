import { posthogHost, posthogKey } from "@/lib/analytics/config";
import type { FunnelEventName, FunnelEventProperties } from "@/lib/analytics/events";

/** Upper bound on how long a capture may hold the request (or the waitUntil) open. */
const DELIVERY_TIMEOUT_MS = 3_000;

export type ServerAnalyticsDeps = {
  key: () => string | undefined;
  host: () => string;
  fetch: typeof fetch;
  /** The request's waitUntil, or null outside a Cloudflare request (next dev, tests). */
  waitUntil: () => Promise<((promise: Promise<unknown>) => void) | null>;
};

const defaultDeps: ServerAnalyticsDeps = {
  key: posthogKey,
  host: posthogHost,
  fetch: (input, init) => fetch(input, init),
  waitUntil: async () => {
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const { ctx } = getCloudflareContext();
      return ctx?.waitUntil ? (promise) => ctx.waitUntil(promise) : null;
    } catch {
      return null;
    }
  },
};

/**
 * Captures one funnel event for a user, by Neon Auth user id only (never the email). Never throws: analytics must not
 * fail sign-up, onboarding or billing.
 *
 * One plain POST to PostHog's capture endpoint instead of posthog-node: no SDK in the Worker bundle, and no shared
 * queue that a reused isolate could flush during another request. Delivery is handed to the Worker's waitUntil so the
 * response is not delayed; outside a Worker it is awaited.
 */
export async function captureServerEvent<E extends FunnelEventName>(
  event: E,
  distinctId: string,
  properties: FunnelEventProperties[E],
  deps: ServerAnalyticsDeps = defaultDeps,
): Promise<void> {
  try {
    const key = deps.key();
    if (!key || !distinctId) return;
    const delivery = deps
      .fetch(`${deps.host()}/i/v0/e/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          event,
          distinct_id: distinctId,
          properties: { ...properties, $lib: "vantage-server" },
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      })
      .then((response) => {
        if (!response.ok) console.error("[analytics] delivery rejected", { event, status: response.status });
      })
      .catch(() => {
        console.error("[analytics] delivery failed", { event });
      });
    const waitUntil = await deps.waitUntil();
    if (waitUntil) waitUntil(delivery);
    else await delivery;
  } catch (error) {
    console.error("[analytics] capture failed", { event, error: error instanceof Error ? error.name : "unknown" });
  }
}
