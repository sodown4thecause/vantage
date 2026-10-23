import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";

import { ANALYTICS_PROXY_PATH, posthogKey, posthogUiHost } from "@/lib/analytics/config";
import { sentryOptions } from "@/lib/observability/sentry-options.mjs";

// No replayIntegration: the free plan allows 50 replays a month.
Sentry.init(sentryOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
}));

const key = posthogKey();
if (key) {
  posthog.init(key, {
    api_host: ANALYTICS_PROXY_PATH,
    ui_host: posthogUiHost(),
    // Anonymous visitors stay anonymous; a person profile exists only after identify on sign-in.
    person_profiles: "identified_only",
    defaults: "2026-08-30",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
