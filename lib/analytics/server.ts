import { PostHog } from "posthog-node";

import { posthogHost, posthogKey } from "@/lib/analytics/config";
import type { FunnelEventName, FunnelEventProperties } from "@/lib/analytics/events";

/** Upper bound on how long a capture may hold the request (or the waitUntil) open. */
const DELIVERY_TIMEOUT_MS = 3_000;

type AnalyticsClient = Pick<PostHog, "capture" | "shutdown">;

export type ServerAnalyticsDeps = {
  key: () => string | undefined;
  client: (key: string) => AnalyticsClient;
  /** The request's waitUntil, or null outside a Cloudflare request (next dev, tests). */
  waitUntil: () => Promise<((promise: Promise<unknown>) => void) | null>;
};

const defaultDeps: ServerAnalyticsDeps = {
  key: posthogKey,
  // A client per capture: a Worker isolate is reused across requests, and a shared queue would let one request's
  // events be flushed (or lost) during another's. flushAt 1 and flushInterval 0 send each event immediately.
  client: (key) => new PostHog(key, { host: posthogHost(), flushAt: 1, flushInterval: 0 }),
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
 * fail sign-up, onboarding or billing. Delivery is handed to the Worker's waitUntil so the response is not delayed;
 * outside a Worker it is awaited. Either way the event is only counted as sent once `shutdown` has flushed it —
 * `captureImmediate` can resolve before the request leaves the isolate.
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
    const client = deps.client(key);
    client.capture({ distinctId, event, properties });
    const delivery = client.shutdown(DELIVERY_TIMEOUT_MS).catch(() => {
      console.error("[analytics] delivery failed", { event });
    });
    const waitUntil = await deps.waitUntil();
    if (waitUntil) waitUntil(delivery);
    else await delivery;
  } catch (error) {
    console.error("[analytics] capture failed", { event, error: error instanceof Error ? error.name : "unknown" });
  }
}
