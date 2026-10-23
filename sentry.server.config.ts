import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/observability/sentry-options.mjs";

// On Workers, `withSentry` in worker-entry.mjs creates the client and this init only applies the build release.
// Under `next dev` (Node) this is the real client.
Sentry.init(sentryOptions({ dsn: process.env.SENTRY_DSN, environment: process.env.SENTRY_ENVIRONMENT }));
