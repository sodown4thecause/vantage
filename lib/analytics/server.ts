import { posthogHost, posthogKey } from "@/lib/analytics/config";

const DELIVERY_TIMEOUT_MS = 3_000;

export type ServerExceptionContext = {
  workspaceId: string;
  /** Short stable label for where it failed, e.g. "embed-backfill" or "collect". */
  area: string;
  sourceId?: string;
};

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
 * Reports a handled server failure to PostHog error tracking as an `$exception`. Never throws.
 *
 * Only the error class name, the area and the ids are sent. The message and stack are deliberately dropped because
 * they can embed document text, tokens or provider payloads. It is one plain POST (no SDK, no shared queue that a
 * reused isolate could flush during another request), handed to waitUntil so the response is not delayed.
 */
export async function captureServerException(
  error: unknown,
  context: ServerExceptionContext,
  deps: ServerAnalyticsDeps = defaultDeps,
): Promise<void> {
  try {
    const key = deps.key();
    if (!key) return;
    const type = error instanceof Error && /^[A-Za-z0-9_$]{1,64}$/.test(error.name) ? error.name : "Error";
    const delivery = deps
      .fetch(`${deps.host()}/i/v0/e/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          event: "$exception",
          distinct_id: `workspace:${context.workspaceId}`,
          properties: {
            $process_person_profile: false,
            $lib: "vantage-server",
            $exception_list: [{ type, value: `${context.area} failed`, mechanism: { handled: true, synthetic: true } }],
            $exception_fingerprint: `${context.area}:${type}`,
            workspaceId: context.workspaceId,
            area: context.area,
            ...(context.sourceId ? { sourceId: context.sourceId } : {}),
          },
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      })
      .then((response) => {
        if (!response.ok) console.error("[analytics] exception delivery rejected", { status: response.status });
      })
      .catch(() => {
        console.error("[analytics] exception delivery failed");
      });
    const waitUntil = await deps.waitUntil();
    if (waitUntil) waitUntil(delivery);
    else await delivery;
  } catch {
    console.error("[analytics] exception capture failed");
  }
}
