import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/observability/sentry-options.mjs";

// See sentry.server.config.ts: on Workers the client comes from `withSentry` in worker-entry.mjs.
Sentry.init(sentryOptions({ dsn: process.env.SENTRY_DSN, environment: process.env.SENTRY_ENVIRONMENT }));
