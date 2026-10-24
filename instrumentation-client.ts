import posthog from "posthog-js";

import { ANALYTICS_PROXY_PATH, posthogKey, posthogUiHost } from "@/lib/analytics/config";

// Browser analytics and browser error tracking. Worker-side errors go to Cloudflare Workers Issues (wrangler.jsonc).
const key = posthogKey();
if (key) {
  posthog.init(key, {
    api_host: ANALYTICS_PROXY_PATH,
    ui_host: posthogUiHost(),
    // Anonymous visitors stay anonymous; a person profile exists only after identify on sign-in.
    person_profiles: "identified_only",
    defaults: "2026-08-30",
    // Uncaught errors and unhandled rejections become PostHog error-tracking exceptions.
    capture_exceptions: true,
  });
}
