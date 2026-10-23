import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { ANALYTICS_PROXY_PATH, posthogAssetsHost, posthogHost } from "./lib/analytics/config";

const nextConfig: NextConfig = {
  // PostHog's API paths end in a slash (/e/, /flags/). Next would 308 them to the slash-less path before the rewrite
  // runs, so the automatic trailing-slash redirect is switched off and restored below for every other path.
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      { source: `/:path((?!${ANALYTICS_PROXY_PATH.slice(1)}/).+)/`, destination: "/:path", permanent: true },
    ];
  },
  async rewrites() {
    const host = posthogHost();
    const assets = posthogAssetsHost(host);
    return [
      { source: `${ANALYTICS_PROXY_PATH}/static/:path*`, destination: `${assets}/static/:path*` },
      { source: `${ANALYTICS_PROXY_PATH}/array/:path*`, destination: `${assets}/array/:path*` },
      { source: `${ANALYTICS_PROXY_PATH}/:path*`, destination: `${host}/:path*` },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Source maps upload only when SENTRY_AUTH_TOKEN is set (the Deploy workflow). CI and local builds skip it.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Uploaded maps are removed from the build so they are never served publicly.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  telemetry: false,
});
