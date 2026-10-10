/**
 * Cloudflare Workers entrypoint.
 *
 * `@opennextjs/cloudflare` emits a Worker whose only export is `fetch`, but Cron
 * Triggers invoke `scheduled`. This wrapper delegates `fetch` to the generated
 * OpenNext worker and adds the scheduled handler.
 *
 * The handler reaches the scan, digest and fallback tick logic through the
 * `WORKER_SELF_REFERENCE` service binding rather than importing app source
 * directly. Importing app source here would make esbuild emit a *second* copy
 * of the pipelines and Drizzle alongside the OpenNext bundle. A service binding
 * instead re-enters the single bundle that is already deployed, so there is one
 * copy of the code and one set of credentials.
 *
 * The self-fetch carries `Authorization: Bearer <CRON_SECRET>`, which
 * `lib/cron/authorize.ts` already verifies with a constant-time compare, so the
 * existing route needs no Cloudflare-specific authorization path. Keep this file
 * as plain `.mjs`: it references `.open-next/`, which does not exist until the
 * adapter build runs, and `.mjs` is deliberately excluded from `tsconfig`.
 */

import openNextWorker from "./.open-next/worker.js";
import { handleQueue } from "./worker/queue.mjs";

// Workflow class export (the `SCAN` binding). Wrangler requires it on the main module.
export { ScanWorkspace } from "./worker/workflows.mjs";

const TICK_PATH = "/api/cron/tick";
const DIGEST_PATH = "/api/cron/digest";
const SCAN_DUE_PATH = "/api/internal/scan/due";
const COST_ROLLUP_PATH = "/api/internal/scan/rollup";
const ROLLUP_TIMEOUT_MS = 30_000;
const DIGEST_TIMEOUT_MS = 120_000;
// Workflows reject a duplicate instance ID when `create` runs. The docs say it throws but do not
// quote the message, so this wording match is unverified; both documented phrasings are accepted.
const DUPLICATE_INSTANCE = /already (exist|used)/i;

/** Hourly slot (yyyymmddHH, UTC) that makes one scan instance per workspace per cron firing. */
function scanSlot(scheduledTime) {
	return new Date(scheduledTime).toISOString().slice(0, 13).replace(/\D/g, "");
}

/** Starts one Workflow instance per due workspace; duplicates from a retried firing count as skipped. */
async function startScanInstances(controller, env) {
	const response = await env.WORKER_SELF_REFERENCE.fetch(
		new Request(`https://vantage.internal${SCAN_DUE_PATH}`, {
			method: "POST",
			headers: { authorization: `Bearer ${env.CRON_SECRET}`, "content-type": "application/json" },
			body: "{}",
		}),
	);
	if (!response.ok) throw new Error(`due failed: HTTP ${response.status}`);
	const { workspaceIds = [] } = await response.json();

	const slot = scanSlot(controller.scheduledTime);
	const results = await Promise.allSettled(workspaceIds.map((workspaceId) =>
		env.SCAN.create({ id: `scan-${workspaceId}-${slot}`, params: { workspaceId } })));

	let created = 0;
	let skipped = 0;
	const errors = [];
	for (const result of results) {
		if (result.status === "fulfilled") created += 1;
		else if (DUPLICATE_INSTANCE.test(String(result.reason?.message ?? result.reason))) skipped += 1;
		else {
			console.error("[cron] scan instance failed to start", result.reason);
			errors.push(result.reason);
		}
	}
	console.log(`[cron] scan instances: ${created} started, ${skipped} already running, ${errors.length} failed`);
	// Every workspace was attempted above; the scheduled invocation is then marked failed.
	if (errors.length) throw new Error(`${errors.length} of ${workspaceIds.length} scan instances failed to start`);
}

/**
 * Daily cost rollup for the Workflow path, where the tick route (which also rolls up) is not called.
 * Best effort: any failure is logged by class only and never rejects the scheduled invocation.
 */
async function triggerCostRollup(env) {
  try {
    const response = await env.WORKER_SELF_REFERENCE.fetch(
      new Request(`https://vantage.internal${COST_ROLLUP_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.CRON_SECRET}`, "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(ROLLUP_TIMEOUT_MS),
      }),
    );
    if (!response.ok) console.error(`[cron] cost rollup failed: HTTP ${response.status}`);
  } catch (error) {
    console.error("[cron] cost rollup threw", error instanceof Error ? error.name : "unknown");
  }
}

/** Dispatch due digests without letting an email failure fail the scan schedule. */
async function triggerDigests(env) {
  try {
    const response = await env.WORKER_SELF_REFERENCE.fetch(
      new Request(`https://vantage.internal${DIGEST_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.CRON_SECRET}`, "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(DIGEST_TIMEOUT_MS),
      }),
    );
    if (!response.ok) console.error(`[cron] digest dispatch failed: HTTP ${response.status}`);
  } catch (error) {
    console.error("[cron] digest dispatch threw", error instanceof Error ? error.name : "unknown");
  }
}

const worker = {
	fetch(request, env, ctx) {
		return openNextWorker.fetch(request, env, ctx);
	},

	queue(batch, env) {
		return handleQueue(batch, env);
	},

	async scheduled(controller, env) {
		const scheduledTime = new Date(controller.scheduledTime).toISOString();
		console.log(`[cron] tick fired at ${scheduledTime} (${controller.cron})`);

		if (!env.CRON_SECRET) {
			// Fail loud. `lib/cron/authorize.ts` would answer 401 for every
			// invocation of a misconfigured deployment, which is safe but silent —
			// the schedule would simply stop working with nothing in the logs.
			throw new Error("CRON_SECRET is not set");
		}

		if (!env.WORKER_SELF_REFERENCE) {
			throw new Error("WORKER_SELF_REFERENCE binding is missing");
		}

		// Rollout switch: with the Workflow binding present, the tick path is not used.
		if (env.SCAN) {
			// Best-effort side effects still run when starting scans fails.
			try {
				await startScanInstances(controller, env);
			} finally {
				await triggerCostRollup(env);
				await triggerDigests(env);
			}
			return;
		}

		const started = Date.now();
		try {
			const response = await env.WORKER_SELF_REFERENCE.fetch(
				new Request(`https://vantage.internal${TICK_PATH}`, {
					method: "GET",
					headers: {
						authorization: `Bearer ${env.CRON_SECRET}`,
						"x-cron-trigger": controller.cron,
					},
				}),
			);

			const elapsedMs = Date.now() - started;
			if (!response.ok) {
				throw new Error(`tick failed: HTTP ${response.status}`);
			}
			const result = await response.json();
			const failures = [...(result.collectorResults ?? []), ...(result.opportunityResults ?? [])]
				.filter((item) => item.error);
			if (result.ok !== true || failures.length) {
				throw new Error(`tick partial failure: ${failures.length} failed runs`);
			}

			console.log(`[cron] tick completed in ${elapsedMs}ms`);
		} catch (error) {
			console.error(`[cron] tick threw after ${Date.now() - started}ms`, error);
			throw error;
		}
	},
};

export default worker;
