import assert from "node:assert/strict";
import { test } from "node:test";

import { handleQueue } from "../worker/queue.mjs";

const JOB = {
  type: "index-profile",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  profileId: "22222222-2222-4222-8222-222222222222",
};

// Each fetch answers with the next outcome: an HTTP status, or an Error that is thrown.
function harness(outcomes) {
  const seen = [];
  let next = 0;
  const env = {
    CRON_SECRET: "test-secret",
    WORKER_SELF_REFERENCE: { fetch: async (request) => {
      seen.push({ url: request.url, method: request.method, authorization: request.headers.get("authorization"), body: await request.json() });
      const outcome = outcomes[next++];
      if (outcome instanceof Error) throw outcome;
      return new Response("body", { status: outcome });
    } },
  };
  return { env, seen };
}

function batchOf(bodies, attempts = 1) {
  const acks = [];
  const retries = [];
  const messages = bodies.map((body, index) => ({
    body,
    attempts,
    ack: () => acks.push(index),
    retry: (options) => retries.push({ index, options }),
  }));
  return { batch: { messages }, acks, retries };
}

test("posts each message to the backfill route with the cron bearer and acks on 200", async () => {
  const { env, seen } = harness([200]);
  const { batch, acks, retries } = batchOf([JOB]);
  await handleQueue(batch, env);
  assert.deepEqual(acks, [0]);
  assert.deepEqual(retries, []);
  assert.deepEqual(seen, [{
    url: "https://vantage.internal/api/internal/embed/backfill",
    method: "POST",
    authorization: "Bearer test-secret",
    body: JOB,
  }]);
});

test("acks 404 and other permanent 4xx responses instead of retrying them", async () => {
  for (const status of [400, 401, 404, 409]) {
    const { env } = harness([status]);
    const { batch, acks, retries } = batchOf([JOB]);
    await handleQueue(batch, env);
    assert.deepEqual(acks, [0], `status ${status}`);
    assert.deepEqual(retries, [], `status ${status}`);
  }
});

test("retries 500 with a delay of 30 seconds times the attempt number", async () => {
  const { env } = harness([500]);
  const { batch, acks, retries } = batchOf([JOB], 3);
  await handleQueue(batch, env);
  assert.deepEqual(acks, []);
  assert.deepEqual(retries, [{ index: 0, options: { delaySeconds: 90 } }]);
});

test("retries 429 even though it is a 4xx", async () => {
  const { env } = harness([429]);
  const { batch, acks, retries } = batchOf([JOB]);
  await handleQueue(batch, env);
  assert.deepEqual(acks, []);
  assert.deepEqual(retries, [{ index: 0, options: { delaySeconds: 30 } }]);
});

test("retries when the self-reference call itself throws", async () => {
  const { env } = harness([new Error("network reset")]);
  const { batch, acks, retries } = batchOf([JOB]);
  await handleQueue(batch, env);
  assert.deepEqual(acks, []);
  assert.deepEqual(retries, [{ index: 0, options: { delaySeconds: 30 } }]);
});

test("processes every message even when an earlier one retries", async () => {
  const { env, seen } = harness([500, 200, 404]);
  const { batch, acks, retries } = batchOf([JOB, JOB, JOB]);
  await handleQueue(batch, env);
  assert.equal(seen.length, 3);
  assert.deepEqual(acks, [1, 2]);
  assert.deepEqual(retries, [{ index: 0, options: { delaySeconds: 30 } }]);
});
