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
const OBSERVER_START_TIMEOUT_MS = 100;

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
 * @param {(name: string, workspaceId: string, callback: Function) => Promise<unknown>} [observeStep] Custom span wrapper.
 * @returns {Promise<{ status: "skipped" | "done" | "partial", failures: number }>}
 */
export async function runScan(params, step, call, observeStep) {
  if (observeStep) step = observedSteps(step, params.workspaceId, observeStep);
  if (params.kind === "first") return runFirstScan(params, step, call);
  const { workspaceId } = params;

  const plan = await step.do("plan", async () => {
    const response = await call(PLAN_PATH, { workspaceId });
    // 409 means another run holds the lease; that is a normal outcome, not a failure.
    if (response.status === 409) return { skipped: true, reason: "scan already running" };
    return readJson(response, PLAN_PATH);
  });
  if (plan.skipped) return { status: "skipped", failures: 0 };

  let failures = 0;
  let read = 0;
  let status = "success";
  let summary = { relevant: 0, picked: 0, capped: plan.capped === true };
  try {
    // A source whose collect step exhausts its retries is counted, never fatal to the run.
    const collected = await Promise.all(plan.sourceIds.map(async (sourceId) => {
      try {
        const result = await step.do(`collect:${sourceId}`, COLLECT_STEP, async () =>
          readJson(await call(COLLECT_PATH, { workspaceId, sourceId }), COLLECT_PATH));
        read += (Number(result.inserted) || 0) + (Number(result.skipped) || 0);
        if (result.partial === true) status = "partial";
        return true;
      } catch {
        return false;
      }
    }));
    failures = collected.filter((ok) => !ok).length;
    if (failures > 0) status = "partial";

    await step.do("embed", async () => readJson(await call(EMBED_PATH, { workspaceId }), EMBED_PATH));
    const built = await step.do("build", BUILD_STEP, async () => readJson(await call(BUILD_PATH, { workspaceId }), BUILD_PATH));
    summary = {
      relevant: Number(built.relevant) || 0,
      picked: Array.isArray(built.top) ? built.top.length : Number(built.picked) || 0,
      capped: summary.capped || built.coverage === "budget_limited",
    };
  } catch (error) {
    status = "failed";
    throw error;
  } finally {
    // Always release the lease this run claimed, even when build throws.
    await step.do("finish", async () =>
      readJson(await call(FINISH_PATH, { workspaceId, leaseToken: plan.leaseToken, read, ...summary, status }), FINISH_PATH));
  }

  return { status: status === "success" ? "done" : status, failures };
}

function observedSteps(step, workspaceId, observeStep) {
  return {
    do(name, ...args) {
      const callbackIndex = args.length - 1;
      const callback = args[callbackIndex];
      if (typeof callback === "function") {
        args[callbackIndex] = (...callbackArgs) => {
          let operationPromise;
          let signalOperationStarted;
          const operationStarted = new Promise((resolve) => { signalOperationStarted = resolve; });
          const runOnce = (...innerArgs) => {
            if (!operationPromise) {
              operationPromise = Promise.resolve().then(() => callback(...innerArgs));
              signalOperationStarted();
            }
            return operationPromise;
          };
          const observerPromise = Promise.resolve()
            .then(() => observeStep(normalizeStepName(name), workspaceId, runOnce))
            .catch(() => undefined);
          let timer;
          const timeout = new Promise((resolve) => {
            timer = setTimeout(resolve, OBSERVER_START_TIMEOUT_MS);
          });
          return (async () => {
            await Promise.race([operationStarted, observerPromise, timeout]);
            clearTimeout(timer);
            // If observation stalls before invoking the callback, start it without waiting longer.
            return await runOnce(...callbackArgs);
          })();
        };
      }
      return step.do(name, ...args);
    },
  };
}

function normalizeStepName(name) {
  const normalized = String(name).replace(/^first:/, "");
  return normalized.startsWith("collect:") ? "collect" : normalized;
}

async function runFirstScan({ workspaceId }, step, call) {
  const path = "/api/internal/scan/first";
  let plan;
  let partial = false;
  let failed = true;
  let failures = 0;
  let finalStatus;
  const request = async (action, extra = {}) => readJson(await call(path, {
    workspaceId, action, ...(plan ? { leaseToken: plan.leaseToken } : {}), ...extra,
  }), path);
  try {
    plan = await step.do("first:plan", {
      retries: { limit: 10, delay: "1 minute", backoff: "constant" }, timeout: "1 minute",
    }, () => request("plan"));
    if (plan.skipped) return { status: "skipped", failures: 0 };
    const collected = await Promise.all(plan.sourceIds.map((sourceId) =>
      step.do(`first:collect:${sourceId}`, COLLECT_STEP, () => request("collect", { sourceId }))
        .catch(() => ({ failed: true, read: 0 }))));
    failures = collected.filter((item) => item.failed).length;
    partial = failures > 0 || collected.some((item) => item.partial);
    await step.do("first:read", () => request("read", {
      read: collected.reduce((sum, item) => sum + (Number(item.read) || 0), 0),
    }));
    const built = await step.do("first:build", BUILD_STEP, () => request("build"));
    partial ||= built.partial === true;
    failed = collected.length > 0 && failures === collected.length && !built.picked;
  } finally {
    if (!plan?.skipped) {
      const finished = await step.do("first:finish", {
        retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "1 minute",
      }, () => request("finish", { failed, partial }));
      finalStatus = finished.status;
    }
  }
  return { status: finalStatus ?? (failed ? "failed" : partial ? "partial" : "done"), failures };
}
