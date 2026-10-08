/**
 * Embed queue consumer (`vantage-embed-jobs`). Pure and injectable so it runs under node:test:
 * it imports nothing from `lib/` or `app/`. Each message is forwarded to the app's backfill route
 * through the `WORKER_SELF_REFERENCE` binding, so the app stays the only place that touches Neon
 * and Vectorize. Messages carry IDs only; the route re-reads the rows.
 */

const BACKFILL_PATH = "/api/internal/embed/backfill";
const RETRY_STEP_SECONDS = 30;

/**
 * Permanent failures (bad request, gone) are acked so they do not loop to the DLQ. 401 is retried: it
 * usually means a missing or mismatched CRON_SECRET, a configuration fault that must not drop work.
 */
function isPermanent(status) {
  return status >= 400 && status < 500 && status !== 401 && status !== 429;
}

/** Delivers every message in the batch. One failing message never prevents the others from running. */
export async function handleQueue(batch, env) {
  for (const message of batch.messages) {
    let status;
    try {
      const response = await env.WORKER_SELF_REFERENCE.fetch(
        new Request(`https://vantage.internal${BACKFILL_PATH}`, {
          method: "POST",
          headers: { authorization: `Bearer ${env.CRON_SECRET}`, "content-type": "application/json" },
          body: JSON.stringify(message.body),
        }),
      );
      status = response.status;
    } catch {
      // Transport failure: no status to classify, so retry with the same backoff as a 5xx.
      status = 0;
    }
    if ((status >= 200 && status < 300) || isPermanent(status)) {
      message.ack();
    } else {
      console.error(`[queue] embed job retry (HTTP ${status || "error"}, attempt ${message.attempts})`);
      message.retry({ delaySeconds: RETRY_STEP_SECONDS * message.attempts });
    }
  }
}
