import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * No incremental-cache override: every Vantage surface is dynamic
 * (`app/api/cron/tick/route.ts` sets `dynamic = "force-dynamic"`, and the pages
 * read the workspace from the session on each request). The default in-memory
 * cache is discarded between invocations, which matches how the app already
 * behaves, and it avoids requiring an R2 bucket before the first deploy.
 */
export default defineCloudflareConfig();
