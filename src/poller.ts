import { getSources } from "./registry";
import {
  loadRegistryFingerprint,
  loadSourceStates,
  registryFingerprint,
  saveRegistryFingerprint,
  syncSources,
  type SourceState,
} from "./db";
import type { Env, QueueMessage, Source } from "./types";

// ---------------------------------------------------------------------------
// Politeness floor: never enqueue the same source more often than this, even if
// the cron fires more frequently. This is separate from per-host rate limits,
// which the consumer enforces at the HTTP layer.
// ---------------------------------------------------------------------------

interface DueDecision {
  readonly due: ReadonlyArray<Source>;
  readonly skipped: number;
}

/** True when enough time has elapsed since the last poll for this source. */
function isDue(source: Source, state: SourceState | undefined, now: number): boolean {
  if (!state?.lastPolledAt) return true;
  const lastPolled = Date.parse(state.lastPolledAt);
  if (Number.isNaN(lastPolled)) return true;
  const elapsedMs = now - lastPolled;
  return elapsedMs >= source.pollIntervalMinutes * 60_000;
}

export function selectDueSources(
  sources: ReadonlyArray<Source>,
  states: ReadonlyMap<string, SourceState>,
  now: number,
): DueDecision {
  const due: Source[] = [];
  let skipped = 0;
  for (const source of sources) {
    if (!source.enabled) {
      skipped += 1;
      continue;
    }
    if (isDue(source, states.get(source.id), now)) {
      due.push(source);
    } else {
      skipped += 1;
    }
  }
  return { due, skipped };
}

/**
 * Cron entrypoint. Its ONLY job is to (a) sync the registry mirror and
 * (b) enqueue one message per due source. It never fetches upstream — that
 * keeps cron fast, under the trigger budget, and lets the consumer scale and
 * retry independently.
 */
export async function runPoller(env: Env): Promise<void> {
  const startedAt = Date.now();
  const sources = getSources();

  // Only mirror the registry when it actually changed. Writes the fingerprint
  // back after a sync so the very next tick can skip both the digest comparison
  // and the upsert. A changed registry still syncs on the same tick.
  //
  // Note: a source disabled at runtime by the consumer (persistent 4xx) stays
  // disabled while the fingerprint is unchanged, but ANY registry change re-runs
  // `syncSources`, which restores `enabled` from config. That is intentional — a
  // config edit is a human decision and may be fixing the dead feed.
  const fingerprint = await registryFingerprint(sources);
  const lastFingerprint = await loadRegistryFingerprint(env.DATABASE_URL);
  const registryChanged = fingerprint !== lastFingerprint;
  if (registryChanged) {
    await syncSources(env.DATABASE_URL, sources);
    await saveRegistryFingerprint(env.DATABASE_URL, fingerprint);
  }

  const states = await loadSourceStates(
    env.DATABASE_URL,
    sources.map((s) => s.id),
  );

  const { due, skipped } = selectDueSources(sources, states, startedAt);
  const enqueuedAt = new Date(startedAt).toISOString();

  // Enqueue in one batch; CF queues accept up to 100 messages per send.
  const messages: QueueMessage[] = due.map((source) => ({
    kind: "poll-source",
    sourceId: source.id,
    enqueuedAt,
  }));

  for (let i = 0; i < messages.length; i += 100) {
    await env.INGEST_QUEUE.sendBatch(
      messages.slice(i, i + 100).map((body) => ({ body })),
    );
  }

  console.log(
    JSON.stringify({
      event: "poller.complete",
      totalSources: sources.length,
      due: due.length,
      skipped,
      registryChanged,
      durationMs: Date.now() - startedAt,
    }),
  );
}
