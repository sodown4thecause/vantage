import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";

mock.method(console, "error", () => {});

// Run the real wrapper without requiring a generated OpenNext bundle.
const source = readFileSync(new URL("../worker-entry.mjs", import.meta.url), "utf8")
  .replace('import openNextWorker from "./.open-next/worker.js";',
    'const openNextWorker = { fetch: () => new Response("app") };');
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
