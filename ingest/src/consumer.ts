import { findSource } from "./registry";
import {
  disableSource,
  insertItems,
  loadSourceStates,
  recordJob,
  recordPoll,
} from "./db";
import { FetchError, fetchSource, type FetchOutcome } from "./fetcher";
import { normalize, normalizeSignals } from "./normalizer";
import { classifyBatch } from "./classify/handler";
import { getClassifierConfig } from "./classify/config";
import type { Env, NormalizedItem, QueueMessage, Source } from "./types";

// ---------------------------------------------------------------------------
// The consumer: fetch -> normalize -> dedup -> write. One bad feed throws its
// own message into retry; it never affects other messages in the batch.
// ---------------------------------------------------------------------------

interface PollOutcome {
  readonly status: "ok" | "not-modified" | "error";
  readonly httpStatus: number | null;
  readonly itemCount: number;
  readonly dedupedCount: number;
}

async function ingestItems(
  env: Env,
  source: Source,
  items: ReadonlyArray<NormalizedItem>,
): Promise<{ inserted: number; offered: number }> {
  const result = await insertItems(env.DATABASE_URL, items);
  await enqueueClassification(env, result.insertedIds);
  return { inserted: result.inserted, offered: result.offered };
}

/**
 * Enqueue classification for freshly-inserted items, if the classifier is on.
 *
 * Producer side of the decoupled classification path: ingest never waits on the
 * LLM. When disabled, we skip entirely so no messages are produced at all.
 * Messages are chunked to respect the classifier's per-message item cap.
 */
async function enqueueClassification(env: Env, itemIds: ReadonlyArray<number>): Promise<void> {
  if (itemIds.length === 0) return;
  const config = getClassifierConfig(env);
  if (!config.enabled) return;

  const enqueuedAt = new Date().toISOString();
  for (let i = 0; i < itemIds.length; i += config.maxItemsPerMessage) {
    const chunk = itemIds.slice(i, i + config.maxItemsPerMessage);
    await env.CLASSIFY_QUEUE.send({ kind: "classify-batch", enqueuedAt, itemIds: chunk });
  }
}

async function logOutcome(
  env: Env,
  sourceId: string,
  outcome: PollOutcome,
  durationMs: number,
  error: string | null,
): Promise<void> {
  console.log(
    JSON.stringify({
      event: "source.poll",
      sourceId,
      status: outcome.status,
      httpStatus: outcome.httpStatus,
      itemCount: outcome.itemCount,
      dedupedCount: outcome.dedupedCount,
      durationMs,
      error,
    }),
  );
  await recordJob(env.DATABASE_URL, {
    sourceId,
    status: outcome.status,
    httpStatus: outcome.httpStatus,
    itemCount: outcome.itemCount,
    dedupedCount: outcome.dedupedCount,
    durationMs,
    error,
  }).catch((auditError: unknown) => {
    // Audit is best-effort; never let it fail the ingest.
    console.error(
      JSON.stringify({ event: "job.audit.failed", sourceId, error: String(auditError) }),
    );
  });
}

/** Poll one source end-to-end. Throws on fetch/parse failure (=> queue retry). */
export async function pollSource(env: Env, source: Source): Promise<PollOutcome> {
  const startedAt = Date.now();
  const fetchedAt = new Date(startedAt).toISOString();

  const states = await loadSourceStates(env.DATABASE_URL, [source.id]);
  const state = states.get(source.id);

  let outcome: FetchOutcome;
  try {
    outcome = await fetchSource(source, env, {
      etag: state?.etag ?? null,
      lastModified: state?.lastModified ?? null,
    });
  } catch (error: unknown) {
    // A permanent 4xx (dead/forbidden feed) must not burn the retry budget on
    // every tick. Disable the source in the DB mirror, log loudly with an audit
    // row, and rethrow so `handleQueue` acks instead of retrying.
    if (error instanceof FetchError && !error.retryable) {
      console.error(
        JSON.stringify({
          event: "source.permanently_gone",
          sourceId: source.id,
          httpStatus: error.status,
          detail: error.message,
        }),
      );
      await disableSource(env.DATABASE_URL, source.id).catch((disableError: unknown) => {
        console.error(
          JSON.stringify({
            event: "source.disable.failed",
            sourceId: source.id,
            error: String(disableError),
          }),
        );
      });
      await logOutcome(
        env,
        source.id,
        { status: "error", httpStatus: error.status, itemCount: 0, dedupedCount: 0 },
        Date.now() - startedAt,
        error.message,
      );
    }
    throw error;
  }

  if (outcome.kind === "not-modified") {
    await recordPoll(env.DATABASE_URL, source.id, outcome.etag, outcome.lastModified);
    const result: PollOutcome = {
      status: "not-modified",
      httpStatus: 304,
      itemCount: 0,
      dedupedCount: 0,
    };
    await logOutcome(env, source.id, result, Date.now() - startedAt, null);
    return result;
  }

  const items = await normalize(source, outcome.body, fetchedAt);
  const { inserted } = await ingestItems(env, source, items);

  await recordPoll(env.DATABASE_URL, source.id, outcome.etag, outcome.lastModified);

  const result: PollOutcome = {
    status: "ok",
    httpStatus: outcome.status,
    itemCount: items.length,
    dedupedCount: items.length - inserted,
  };
  await logOutcome(env, source.id, result, Date.now() - startedAt, null);
  return result;
}

/** Handle operator/API-supplied signals (future Grok/X scanner seam). */
async function ingestSignalMessage(
  env: Env,
  message: Extract<QueueMessage, { kind: "ingest-signal" }>,
): Promise<void> {
  const source = findSource(message.sourceId);
  if (!source) throw new Error(`ingest-signal references unknown source "${message.sourceId}"`);

  const startedAt = Date.now();
  const fetchedAt = new Date(startedAt).toISOString();
  const items = await normalizeSignals(source, message.items, fetchedAt);
  const { inserted } = await ingestItems(env, source, items);
  await logOutcome(
    env,
    source.id,
    {
      status: "ok",
      httpStatus: null,
      itemCount: items.length,
      dedupedCount: items.length - inserted,
    },
    Date.now() - startedAt,
    null,
  );
}

async function handleMessage(env: Env, message: QueueMessage): Promise<void> {
  if (message.kind === "classify-batch") {
    await classifyBatch(env, message.itemIds);
    return;
  }
  if (message.kind === "ingest-signal") {
    await ingestSignalMessage(env, message);
    return;
  }

  const source = findSource(message.sourceId);
  if (!source) {
    // Unknown source is a permanent error: log loudly, do NOT retry.
    console.error(
      JSON.stringify({ event: "source.unknown", sourceId: message.sourceId }),
    );
    return;
  }
  await pollSource(env, source);
}

/**
 * Queue handler. `retry()` re-delivers the message with the queue's exponential
 * backoff; `ack()` after max retries routes to the dead-letter queue instead of
 * poisoning the queue. A single failing message never blocks its batch-mates.
 */
export async function handleQueue(
  batch: MessageBatch<QueueMessage>,
  env: Env,
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (message) => {
      const startedAt = Date.now();
      try {
        await handleMessage(env, message.body);
        message.ack();
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        if (error instanceof FetchError && !error.retryable) {
          // Permanent: ack to stop the retry loop. `pollSource` already disabled
          // the source and logged the audit row.
          console.error(
            JSON.stringify({
              event: "message.permanent",
              sourceId: (message.body as { sourceId?: string }).sourceId ?? null,
              attempts: message.attempts,
              httpStatus: error.status,
              durationMs: Date.now() - startedAt,
              error: detail,
            }),
          );
          message.ack();
          return;
        }
        console.error(
          JSON.stringify({
            event: "message.failed",
            sourceId: (message.body as { sourceId?: string }).sourceId ?? null,
            attempts: message.attempts,
            durationMs: Date.now() - startedAt,
            error: detail,
          }),
        );
        message.retry();
      }
    }),
  );
}
