import { posthogHost, posthogKey } from "@/lib/analytics/config";
import { getCloudflareRequestContext } from "@/lib/cf/env";

const DELIVERY_TIMEOUT_MS = 3_000;
const SAFE_ANALYTICS_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function safeAnalyticsId(value: string | undefined): string | undefined {
  return value && SAFE_ANALYTICS_ID.test(value) ? value : undefined;
}

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
    const ctx = await getCloudflareRequestContext();
    return typeof ctx?.waitUntil === "function" ? (promise) => ctx.waitUntil?.(promise) : null;
  },
};

export type ProductEventInput =
  | { event: "signed_up" | "profile_confirmed"; userId?: string; workspaceId: string }
  | { event: "scan_started"; userId?: string; workspaceId: string }
  | { event: "scan_finished"; userId?: string; workspaceId: string; read: number; relevant: number; picked: number; capped: boolean }
  | { event: "digest_sent" | "reply_copied" | "thread_opened" | "unsubscribed"; userId?: string; workspaceId: string }
  | { event: "outcome_marked"; userId: string; workspaceId: string; outcome: "sent" | "replied" }
  | { event: "checkout_started" | "subscribed"; userId: string; workspaceId?: string };

/** Sends a deliberately small, typed product event through the same privacy-safe server fetch path as exceptions. */
export async function captureProductEvent(
  input: ProductEventInput,
  deps: ServerAnalyticsDeps = defaultDeps,
): Promise<void> {
  try {
    const key = deps.key();
    if (!key) return;
    const { event } = input;
    const workspaceId = safeAnalyticsId(input.workspaceId);
    const userId = safeAnalyticsId(input.userId);
    if (!workspaceId && !userId) return;
    const properties: Record<string, string | number | boolean> = {
      $process_person_profile: false,
      $lib: "vantage-server",
      ...(workspaceId ? { workspaceId } : {}),
      ...(input.event === "scan_finished" ? {
        read: input.read,
        relevant: input.relevant,
        picked: input.picked,
        capped: input.capped,
      } : {}),
      ...(input.event === "outcome_marked" ? { outcome: input.outcome } : {}),
    };
    const delivery = deps.fetch(`${deps.host()}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: workspaceId ? `workspace:${workspaceId}` : userId!,
        properties,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    }).then((response) => {
      if (!response.ok) console.error("[analytics] event delivery rejected", { status: response.status });
    }).catch(() => {
      console.error("[analytics] event delivery failed");
    });
    const waitUntil = await deps.waitUntil();
    if (waitUntil) waitUntil(delivery);
    else await delivery;
  } catch {
    console.error("[analytics] event capture failed");
  }
}

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
