/**
 * Cloudflare Workers entrypoint.
 *
 * `@opennextjs/cloudflare` emits a Worker whose only export is `fetch`, but Cron
 * Triggers invoke `scheduled`. This wrapper delegates `fetch` to the generated
 * OpenNext worker and adds the scheduled handler.
 *
 * The handler reaches the tick logic through the `WORKER_SELF_REFERENCE` service
 * binding rather than importing `lib/cron/tick` directly. Importing app source
 * here would make esbuild emit a *second* copy of the tick pipeline, collectors,
 * and Drizzle alongside the OpenNext bundle. A service binding instead re-enters
 * the single bundle that is already deployed, so there is one copy of the code
 * and one set of credentials.
 *
 * The self-fetch carries `Authorization: Bearer <CRON_SECRET>`, which
 * `lib/cron/authorize.ts` already verifies with a constant-time compare, so the
 * existing route needs no Cloudflare-specific authorization path. Keep this file
 * as plain `.mjs`: it references `.open-next/`, which does not exist until the
 * adapter build runs, and `.mjs` is deliberately excluded from `tsconfig`.
 */

import openNextWorker from "./.open-next/worker.js";

const TICK_PATH = "/api/cron/tick";

const worker = {
	fetch(request, env, ctx) {
		return openNextWorker.fetch(request, env, ctx);
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
