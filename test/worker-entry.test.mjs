import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";

mock.method(console, "error", () => {});

// Run the real wrapper without requiring a generated OpenNext bundle.
// The Workflow re-export is stubbed too: relative and cloudflare:* imports cannot load from a data: URL.
const source = readFileSync(new URL("../worker-entry.mjs", import.meta.url), "utf8")
  .replace('import openNextWorker from "./.open-next/worker.js";',
    'const openNextWorker = { fetch: () => new Response("app") };')
  .replace('export { ScanWorkspace } from "./worker/workflows.mjs";',
    "export class ScanWorkspace {}");
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const controller = { scheduledTime: 0, cron: "0 */3 * * *" };
const env = (body = { ok: true, collectorResults: [], opportunityResults: [] }) => ({
  CRON_SECRET: "test-secret",
  WORKER_SELF_REFERENCE: { fetch: async (request) => {
    assert.equal(request.headers.get("authorization"), "Bearer test-secret");
    assert.equal(new URL(request.url).pathname, "/api/cron/tick");
    return Response.json(body);
  } },
});

test("delegates web requests to the application", async () => {
  assert.equal(await (await worker.fetch(new Request("https://example.com"), {}, {})).text(), "app");
});
test("fails the scheduled invocation when configuration is missing", async () => {
  await assert.rejects(worker.scheduled(controller, {}), /CRON_SECRET/);
  await assert.rejects(worker.scheduled(controller, { CRON_SECRET: "test" }), /WORKER_SELF_REFERENCE/);
});
test("fails the scheduled invocation when the tick rejects authorization", async () => {
  await assert.rejects(worker.scheduled(controller, {
    ...env(), WORKER_SELF_REFERENCE: { fetch: async () => new Response("unauthorized", { status: 401 }) },
  }), /401/);
});
test("reports partial source and opportunity failures even on HTTP 200", async () => {
  for (const body of [
    { ok: true, collectorResults: [{ error: "collector failed" }], opportunityResults: [] },
    { ok: true, collectorResults: [], opportunityResults: [{ error: "opportunity build failed" }] },
    { ok: false, collectorResults: [], opportunityResults: [] },
  ]) await assert.rejects(worker.scheduled(controller, env(body)), /failed|partial/);
});
test("completes a successful scheduled scan", async () => {
  await worker.scheduled(controller, env());
});

// Workflow path: taken whenever env.SCAN exists; the tick path is not called.
const slotTime = Date.UTC(2026, 9, 8, 12, 30);
const scanController = { scheduledTime: slotTime, cron: "0 */3 * * *" };
const scanEnv = ({ dueBody = { workspaceIds: ["ws-1", "ws-2"] }, create } = {}) => {
  const creates = [];
  return {
    creates,
    env: {
      CRON_SECRET: "test-secret",
      WORKER_SELF_REFERENCE: { fetch: async (request) => {
        assert.equal(request.headers.get("authorization"), "Bearer test-secret");
        assert.equal(new URL(request.url).pathname, "/api/internal/scan/due");
        assert.equal(request.method, "POST");
        return Response.json(dueBody);
      } },
      SCAN: { create: async (options) => {
        creates.push(options);
        return create ? create(options) : { id: options.id };
      } },
    },
  };
};

test("starts one scan instance per due workspace, keyed by the scheduled hour", async () => {
  const { env, creates } = scanEnv();
  await worker.scheduled(scanController, env);
  assert.deepEqual(creates, [
    { id: "scan-ws-1-2026100812", params: { workspaceId: "ws-1" } },
    { id: "scan-ws-2-2026100812", params: { workspaceId: "ws-2" } },
  ]);
});
test("treats an already-existing instance as skipped", async () => {
  const { env, creates } = scanEnv({
    create: (options) => {
      if (options.params.workspaceId === "ws-1") throw new Error("Workflow instance ID already exists");
      return { id: options.id };
    },
  });
  await worker.scheduled(scanController, env);
  assert.equal(creates.length, 2);
});
test("rethrows other create failures after attempting every workspace", async () => {
  const { env, creates } = scanEnv({
    create: (options) => {
      if (options.params.workspaceId === "ws-1") throw new Error("quota exceeded");
      return { id: options.id };
    },
  });
  await assert.rejects(worker.scheduled(scanController, env), /1 of 2 scan instances failed/);
  assert.equal(creates.length, 2);
});
test("fails the Workflow scheduled invocation when the due lookup fails", async () => {
  const { env } = scanEnv();
  env.WORKER_SELF_REFERENCE = { fetch: async () => new Response("nope", { status: 500 }) };
  await assert.rejects(worker.scheduled(scanController, env), /500/);
});
