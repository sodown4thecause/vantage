/**
 * Workflow class exports for the Worker. Keep this a thin wrapper: all orchestration lives in
 * `scan-run.mjs`, which is unit-tested under node. This file imports `cloudflare:workers`, so
 * it cannot be loaded outside the Workers runtime or wrangler's bundler.
 *
 * `RadarScan` (S21) will join this file as a second export.
 */

import { NonRetryableError, WorkflowEntrypoint } from "cloudflare:workers";

import { runScan } from "./scan-run.mjs";

/**
 * POSTs to an internal scan route through the app's own service binding. The bearer token is
 * checked by the app's fail-closed cron authorization, so the app is the only trust boundary.
 * 409 is returned to the caller (it means another run holds the lease); other non-2xx throw.
 * 4xx other than 409 and 429 are permanent, so NonRetryableError stops the Workflow retry loop.
 */
async function callInternal(env, path, body) {
  const response = await env.WORKER_SELF_REFERENCE.fetch(
    new Request(`https://vantage.internal${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (response.ok || response.status === 409) return response;
  const message = `${path} failed: HTTP ${response.status}`;
  const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
  throw permanent ? new NonRetryableError(message) : new Error(message);
}

export class ScanWorkspace extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    return runScan(event.payload, step, (path, body) => callInternal(env, path, body));
  }
}
