import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * SSR-only: no ISR, no on-demand revalidation in this app, so no R2
 * incremental cache, Durable Object queue or tag cache is required.
 */
export default defineCloudflareConfig({});
