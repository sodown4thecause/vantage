/**
 * One workspace scan expressed as Workflow steps.
 *
 * This module is pure: `step` and `call` are injected, so it runs under plain node and
 * has no `cloudflare:*` or app imports. `worker/workflows.mjs` supplies the real
 * `step` (from WorkflowEntrypoint) and the real `call` (a service-binding request to the
 * internal scan routes in the app bundle).
 *
 * Step return values must stay small JSON (counts and ids), since Workflows caps each
 * step output at 1 MiB.
 */

const PLAN_PATH = "/api/internal/scan/plan";
const COLLECT_PATH = "/api/internal/scan/collect";
const EMBED_PATH = "/api/internal/scan/embed";
const BUILD_PATH = "/api/internal/scan/build";
const FINISH_PATH = "/api/internal/scan/finish";

const COLLECT_STEP = {
  retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
  timeout: "2 minutes",
};
// The brief fixes only limit and timeout for build; delay and backoff mirror collect.
const BUILD_STEP = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

async function readJson(response, path) {
  if (!response.ok) throw new Error(`${path} failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * @param {{ workspaceId: string }} params
 * @param {{ do: Function }} step Workflow step API (`step.do(name, [options], callback)`).
 * @param {(path: string, body: object) => Promise<Response>} call Internal route caller.
 * @returns {Promise<{ status: "skipped" | "done" | "partial", failures: number }>}
 */
export async function runScan(params, step, call) {
  const { workspaceId } = params;

  const plan = await step.do("plan", async () => {
    const response = await call(PLAN_PATH, { workspaceId });
    // 409 means another run holds the lease; that is a normal outcome, not a failure.
    if (response.status === 409) return { skipped: true, reason: "scan already running" };
    return readJson(response, PLAN_PATH);
  });
  if (plan.skipped) return { status: "skipped", failures: 0 };

  let failures = 0;
  try {
    // A source whose collect step exhausts its retries is counted, never fatal to the run.
    const collected = await Promise.all(plan.sourceIds.map(async (sourceId) => {
      try {
        await step.do(`collect:${sourceId}`, COLLECT_STEP, async () =>
          readJson(await call(COLLECT_PATH, { workspaceId, sourceId }), COLLECT_PATH));
        return true;
      } catch {
        return false;
      }
    }));
    failures = collected.filter((ok) => !ok).length;

    await step.do("embed", async () => readJson(await call(EMBED_PATH, { workspaceId }), EMBED_PATH));
    await step.do("build", BUILD_STEP, async () => readJson(await call(BUILD_PATH, { workspaceId }), BUILD_PATH));
  } finally {
    // Always release the lease this run claimed, even when build throws.
    await step.do("finish", async () =>
      readJson(await call(FINISH_PATH, { workspaceId, leaseToken: plan.leaseToken }), FINISH_PATH));
  }

  return { status: failures > 0 ? "partial" : "done", failures };
}
