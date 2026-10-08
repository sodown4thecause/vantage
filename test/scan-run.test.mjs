import assert from "node:assert/strict";
import { test } from "node:test";

import { runScan } from "../worker/scan-run.mjs";

const PARAMS = { workspaceId: "ws-1" };
const LEASE = "lease-1";

const json = (body, status = 200) => Response.json(body, { status });

// Callbacks run inline; each step honours its configured retry limit and records its name, options and attempts.
function fakeStep() {
  const steps = [];
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    steps,
    get maxInFlight() {
      return maxInFlight;
    },
    do: async (name, ...rest) => {
      const fn = rest.at(-1);
      const options = rest.length > 1 ? rest[0] : undefined;
      const record = { name, options, attempts: 0 };
      steps.push(record);
      const limit = options?.retries?.limit ?? 0;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        for (let attempt = 0; ; attempt += 1) {
          record.attempts = attempt + 1;
          try {
            await new Promise((resolve) => setImmediate(resolve));
            return await fn();
          } catch (error) {
            if (attempt >= limit) throw error;
          }
        }
      } finally {
        inFlight -= 1;
      }
    },
  };
}

// Route table: each path maps to a function returning a Response (or throwing, as the real wrapper does).
function fakeCall(overrides = {}) {
  const calls = [];
  const routes = {
    "/api/internal/scan/plan": () => json({ leaseToken: LEASE, sourceIds: ["src-a", "src-b"] }),
    "/api/internal/scan/collect": () => json({ inserted: 1, skipped: 0 }),
    "/api/internal/scan/embed": () => json({ embedded: 3 }),
    "/api/internal/scan/build": () => json({ ok: true }),
    "/api/internal/scan/finish": () => json({ released: true }),
    ...overrides,
  };
  const call = async (path, body) => {
    calls.push({ path, body });
    return routes[path](body);
  };
  return { call, calls };
}

const names = (step) => step.steps.map((record) => record.name);
const record = (step, name) => step.steps.find((entry) => entry.name === name);

test("runs plan, every collect, embed, build, then finish in that order", async () => {
  const step = fakeStep();
  const result = await runScan(PARAMS, step, fakeCall().call);
  assert.deepEqual(names(step), ["plan", "collect:src-a", "collect:src-b", "embed", "build", "finish"]);
  assert.deepEqual(result, { status: "done", failures: 0 });
});

test("configures retries and timeouts for collect and build steps", async () => {
  const step = fakeStep();
  await runScan(PARAMS, step, fakeCall().call);
  assert.deepEqual(record(step, "collect:src-a").options, {
    retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  });
  assert.equal(record(step, "build").options.retries.limit, 2);
  assert.equal(record(step, "build").options.timeout, "5 minutes");
});

test("posts the documented bodies to each internal route", async () => {
  const fake = fakeCall();
  await runScan(PARAMS, fakeStep(), fake.call);
  assert.deepEqual(fake.calls, [
    { path: "/api/internal/scan/plan", body: { workspaceId: "ws-1" } },
    { path: "/api/internal/scan/collect", body: { workspaceId: "ws-1", sourceId: "src-a" } },
    { path: "/api/internal/scan/collect", body: { workspaceId: "ws-1", sourceId: "src-b" } },
    { path: "/api/internal/scan/embed", body: { workspaceId: "ws-1" } },
    { path: "/api/internal/scan/build", body: { workspaceId: "ws-1" } },
    { path: "/api/internal/scan/finish", body: { workspaceId: "ws-1", leaseToken: LEASE } },
  ]);
});

test("a skipped plan ends the run without collecting or finishing", async () => {
  const step = fakeStep();
  const fake = fakeCall({
    "/api/internal/scan/plan": () => json({ skipped: true, reason: "cadence not elapsed" }),
  });
  const result = await runScan(PARAMS, step, fake.call);
  assert.deepEqual(names(step), ["plan"]);
  assert.deepEqual(result, { status: "skipped", failures: 0 });
});

test("a 409 from plan ends the run as skipped without throwing", async () => {
  const step = fakeStep();
  const fake = fakeCall({
    "/api/internal/scan/plan": () => json({ error: "scan already running" }, 409),
  });
  const result = await runScan(PARAMS, step, fake.call);
  assert.deepEqual(names(step), ["plan"]);
  assert.deepEqual(result, { status: "skipped", failures: 0 });
});

test("one collect step that exhausts its retries yields partial and the run still builds and finishes", async () => {
  const step = fakeStep();
  const fake = fakeCall({
    "/api/internal/scan/collect": (body) => {
      if (body.sourceId === "src-b") throw new Error("collector exploded");
      return json({ inserted: 1, skipped: 0 });
    },
  });
  const result = await runScan(PARAMS, step, fake.call);
  assert.equal(record(step, "collect:src-b").attempts, 4, "limit 3 means four attempts");
  assert.equal(record(step, "collect:src-a").attempts, 1);
  assert.deepEqual(result, { status: "partial", failures: 1 });
  assert.ok(names(step).includes("build"));
  assert.equal(names(step).at(-1), "finish");
});

test("finish runs even when build throws, and the build error propagates", async () => {
  const step = fakeStep();
  const fake = fakeCall({
    "/api/internal/scan/build": () => {
      throw new Error("build exploded");
    },
  });
  await assert.rejects(runScan(PARAMS, step, fake.call), /build exploded/);
  assert.equal(names(step).at(-1), "finish");
  assert.deepEqual(fake.calls.at(-1), {
    path: "/api/internal/scan/finish",
    body: { workspaceId: "ws-1", leaseToken: LEASE },
  });
});

test("a plan failure propagates without finishing, because no lease was handed back", async () => {
  const step = fakeStep();
  const fake = fakeCall({
    "/api/internal/scan/plan": () => json({ error: "scan step failed" }, 500),
  });
  await assert.rejects(runScan(PARAMS, step, fake.call), /HTTP 500/);
  assert.deepEqual(names(step), ["plan"]);
});

test("collect steps are launched concurrently", async () => {
  const step = fakeStep();
  await runScan(PARAMS, step, fakeCall().call);
  assert.ok(step.maxInFlight >= 2, `expected overlapping steps, saw ${step.maxInFlight}`);
});
