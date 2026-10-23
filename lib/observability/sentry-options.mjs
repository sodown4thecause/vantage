/**
 * Sentry options shared by the Worker entry (`worker-entry.mjs`, where `withSentry` creates the client on Cloudflare)
 * and the Next.js init files used by `next dev`. Plain `.mjs` so the Worker entry can import it without a TypeScript
 * step, the same reason `worker/*.mjs` is plain JavaScript.
 *
 * Free Developer plan: traces are sampled at 10% and Session Replay is never enabled.
 */

export const TRACES_SAMPLE_RATE = 0.1;

/** Headers that can carry a session, a credential or a webhook signature. Matched case-insensitively. */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-cron-trigger",
  "webhook-signature",
]);

/** "staging" or "production". Anything else, including unset, reports as production. */
export function sentryEnvironment(value) {
  return typeof value === "string" && value.trim() === "staging" ? "staging" : "production";
}

/**
 * Strips cookies, credential headers, request bodies and everything about the user except the id before an event
 * leaves the process. Mutates and returns the event, which is what `beforeSend` expects.
 * @template {{ request?: { cookies?: unknown; data?: unknown; headers?: Record<string, string> }; user?: { id?: string | number } & Record<string, unknown> }} T
 * @param {T} event
 * @returns {T}
 */
export function scrubEvent(event) {
  const request = event.request;
  if (request) {
    delete request.cookies;
    // Bodies hold profile text, interview answers and webhook payloads.
    delete request.data;
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (SENSITIVE_HEADERS.has(name.toLowerCase())) request.headers[name] = "[Filtered]";
      }
    }
  }
  if (event.user) {
    if (event.user.id === undefined) delete event.user;
    else event.user = { id: event.user.id };
  }
  return event;
}

/**
 * Options for `Sentry.init` / `withSentry`. Without a DSN the SDK stays disabled, so local runs and CI send nothing.
 * @param {{ dsn?: string; environment?: string }} input
 */
export function sentryOptions({ dsn, environment }) {
  const trimmed = typeof dsn === "string" ? dsn.trim() : "";
  return {
    dsn: trimmed || undefined,
    enabled: Boolean(trimmed),
    environment: sentryEnvironment(environment),
    tracesSampleRate: TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  };
}

/** `withSentry` options from the Worker env (Cloudflare secrets and vars). */
export function workerSentryOptions(env) {
  return sentryOptions({ dsn: env?.SENTRY_DSN, environment: env?.SENTRY_ENVIRONMENT });
}
