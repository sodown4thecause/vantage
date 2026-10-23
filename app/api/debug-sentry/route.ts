import { sentryEnvironment } from "@/lib/observability/sentry-options.mjs";

export const dynamic = "force-dynamic";

/** The test error this route throws, so the Sentry issue is easy to recognise. */
class SentryDebugError extends Error {
  constructor() {
    super("Sentry debug route: intentional test error");
    this.name = "SentryDebugError";
  }
}

/**
 * GET /api/debug-sentry. Throws on purpose so staging can confirm errors reach Sentry (through `onRequestError`).
 * Answers 404 everywhere else, including when SENTRY_ENVIRONMENT is unset, so production never exposes it.
 */
export function GET(): Response {
  if (!process.env.SENTRY_ENVIRONMENT || sentryEnvironment(process.env.SENTRY_ENVIRONMENT) !== "staging") {
    return new Response("Not found", { status: 404 });
  }
  throw new SentryDebugError();
}
