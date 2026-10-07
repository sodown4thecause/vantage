// ---------------------------------------------------------------------------
// Batch classification handler.
//
// Flow (one `classify-batch` queue message):
//   1. Guard: classifier disabled or no key => ack immediately, do nothing.
//   2. Load the subset of the requested ids that still needs classifying at the
//      current prompt version: never classified, or version-stale from a prompt/
//      model bump. This is the idempotency guard: a re-delivery at the same
//      version finds nothing and re-bills nothing, while a deliberate version
//      bump re-classifies exactly the stale rows once.
//   3. Chunk into batches of `batchSize`, cap at `maxItemsPerMessage`.
//   4. For each batch: build the prompt, call the model with bounded concurrency,
//      validate with zod. On malformed output, do ONE bounded repair re-ask for
//      the missing indices. Anything still missing falls back to `unclassified`.
//   5. Canonicalize + persist entities, then persist classifications.
//   6. Cluster the recent window and persist non-destructive cluster hints.
//
// Failure model: a whole-batch LLM error is retryable (the caller rethrows and
// the queue retries). Nothing here ever writes a half-classified row: a batch is
// persisted only after every one of its items has a result (classified or a
// well-formed `unclassified` fallback).
// ---------------------------------------------------------------------------
import type { Env } from "../types";
import {
  loadClusterCandidates,
  loadUnclassifiedItems,
  saveClassifications,
  saveClusters,
  upsertEntities,
  linkItemEntities,
  type ClassifierInputRow,
  type ClassificationWrite,
  type EntityWrite,
} from "../db";
import { createIncoClient, IncoError, type ChatResult, type IncoClient } from "../inco/client";
import { getClassifierConfig, type ClassifierConfig } from "./config";
import {
  buildClassificationPrompt,
  buildRepairPrompt,
  CLASSIFIER_PROMPT_VERSION,
} from "./prompt";
import {
  parseClassificationResponse,
  type ClassificationItem,
} from "./schema";
import {
  chunkItems,
  isValidRepairIndexSet,
  missingIndices,
  reconcile,
  unclassified,
  type ClassificationInputItem,
  type ReconciledItem,
} from "./batch";
import { canonicalizeEntities } from "../entities/aliases";
import { clusterByGlobalTitleHash, type ClusterableItem } from "../entities/cluster";

/** Recent-window size for clustering; bounds the join cost per message. */
const CLUSTER_WINDOW = 2000;

/** Provider request settings the classifier pins. */
const CLASSIFIER_TEMPERATURE = 0;

export interface ClassifyOutcome {
  readonly status: "classified" | "skipped-disabled" | "skipped-empty";
  readonly attempted: number;
  readonly classified: number;
  readonly unclassified: number;
  readonly clusters: number;
  readonly llmCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** Options seam for tests: inject a mock client and skip real DB work. */
export interface ClassifyDeps {
  /** Override the client factory (tests inject a mock). */
  readonly makeClient?: (env: Env, config: ClassifierConfig) => IncoClient;
  /** Disable the clustering step (used by focused tests). */
  readonly skipClustering?: boolean;
}

/**
 * Classify one batch of item ids. See module header for the flow.
 *
 * `env.INCO_API_KEY` is read here and passed straight to the client; it is never
 * logged. When classification is disabled or the key is absent, this is a no-op
 * that reports `skipped-disabled` (never an error — the queue must not retry a
 * configuration choice).
 */
export async function classifyBatch(
  env: Env,
  itemIds: ReadonlyArray<number>,
  deps: ClassifyDeps = {},
): Promise<ClassifyOutcome> {
  const config = getClassifierConfig(env);
  const apiKey = env.INCO_API_KEY?.trim();
  if (!config.enabled || !apiKey || apiKey === "") {
    console.log(
      JSON.stringify({
        event: "classify.skipped",
        reason: !config.enabled ? "disabled" : "no-api-key",
        requested: itemIds.length,
      }),
    );
    return emptyOutcome("skipped-disabled");
  }

  const rows = await loadUnclassifiedItems(env.DATABASE_URL, itemIds, CLASSIFIER_PROMPT_VERSION);
  if (rows.length === 0) {
    return emptyOutcome("skipped-empty");
  }

  const client = deps.makeClient?.(env, config) ?? createIncoClient({ apiKey });

  const inputItems: ClassificationInputItem[] = rows.map((row) => ({
    id: row.id,
    sourceName: row.sourceName,
    title: row.title,
    summary: row.summary,
    rawContent: row.rawContent,
  }));

  const batches = chunkItems(inputItems, config.batchSize, config.maxItemsPerMessage);
  const counters = { llmCalls: 0, promptTokens: 0, completionTokens: 0 };

  const reconciled: ReconciledItem[] = [];
  for (let i = 0; i < batches.length; i += config.maxConcurrency) {
    const wave = batches.slice(i, i + config.maxConcurrency);
    const waveResults = await Promise.all(
      wave.map((batch) => classifyOneBatch(client, config, batch, counters)),
    );
    for (const result of waveResults) reconciled.push(...result);
  }

  // Canonicalize entity mentions deterministically (LLM only suggests).
  const entityWrites = collectEntities(reconciled);
  const entityIdByName = await upsertEntities(env.DATABASE_URL, entityWrites);
  await persistEntityLinks(env.DATABASE_URL, reconciled, entityIdByName);

  const writes: ClassificationWrite[] = reconciled.map((item) => ({
    id: item.id,
    status: item.status,
    labels: item.labels,
    entities: item.entities,
    relevance: item.relevance,
    reason: item.reason,
    uncertain: item.uncertain,
    model: config.model,
    version: CLASSIFIER_PROMPT_VERSION,
  }));
  await saveClassifications(env.DATABASE_URL, writes);

  let clusters = 0;
  if (!deps.skipClustering) {
    clusters = await clusterRecentWindow(env.DATABASE_URL);
  }

  const classified = reconciled.filter((r) => r.status === "classified").length;
  const outcome: ClassifyOutcome = {
    status: "classified",
    attempted: inputItems.length,
    classified,
    unclassified: reconciled.length - classified,
    clusters,
    llmCalls: counters.llmCalls,
    promptTokens: counters.promptTokens,
    completionTokens: counters.completionTokens,
  };
  console.log(JSON.stringify({ event: "classify.complete", ...outcome }));
  return outcome;
}

interface Counters {
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
}

export type { Counters };

function emptyOutcome(status: ClassifyOutcome["status"]): ClassifyOutcome {
  return {
    status,
    attempted: 0,
    classified: 0,
    unclassified: 0,
    clusters: 0,
    llmCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
  };
}

function recordUsage(counters: Counters, result: ChatResult): void {
  counters.llmCalls += 1;
  if (result.usage !== null) {
    counters.promptTokens += result.usage.promptTokens;
    counters.completionTokens += result.usage.completionTokens;
  }
}

/**
 * Classify one batch: primary call, validate, then ONE bounded repair attempt
 * for missing indices. Returns one result per input item (classified or the
 * `unclassified` fallback) — never throws for malformed model output.
 *
 * Exported (and DB-free) so smoke tests can drive it with a mock `IncoClient`.
 */
export async function classifyOneBatch(
  client: IncoClient,
  config: ClassifierConfig,
  batch: ReadonlyArray<ClassificationInputItem>,
  counters: Counters = { llmCalls: 0, promptTokens: 0, completionTokens: 0 },
): Promise<ReadonlyArray<ReconciledItem>> {
  const primary = await callAndParse(client, config, buildClassificationPrompt(batch), counters);
  const afterPrimary = primary.ok ? primary.items : [];
  const missing = missingIndices(batch, afterPrimary);
  if (missing.length === 0) {
    return reconcile(batch, afterPrimary);
  }

  console.log(
    JSON.stringify({ event: "classify.repair", missing: missing.length, batchSize: batch.length }),
  );
  const repair = await callAndParse(
    client,
    config,
    buildRepairPrompt(batch, missing),
    counters,
  );

  // Map repair results (renumbered 0..n-1) back to original indices. A repair
  // reply whose index set is not a clean subset of {0..missing.length-1} (an
  // original-batch position, a duplicate, or an extra) is treated as a parse
  // failure: mapping it could label the WRONG row. Misnumbered indices fall back
  // to `unclassified` rather than risk a mislabel.
  const repairIndexSetIsSafe = repair.ok
    ? isValidRepairIndexSet(repair.items, missing.length)
    : false;
  if (repair.ok && !repairIndexSetIsSafe) {
    console.error(
      JSON.stringify({
        event: "classify.repair.rejected",
        reason: "repair index set was not a clean subset of the missing ordinals",
        missing: missing.length,
        reported: repair.items.length,
      }),
    );
  }
  const repaired =
    repair.ok && repairIndexSetIsSafe ? remapRepair(repair.items, missing, batch) : [];
  const merged = mergeByIndex(batch.length, afterPrimary, repaired);
  return reconcile(batch, merged);
}

/** One LLM call + parse. Network/http errors propagate (retryable upstream). */
async function callAndParse(
  client: IncoClient,
  config: ClassifierConfig,
  prompt: { readonly system: string; readonly user: string },
  counters: Counters,
): Promise<{ readonly ok: true; readonly items: ReadonlyArray<ClassificationItem> } | { readonly ok: false; readonly reason: string }> {
  let result: ChatResult;
  try {
    result = await client.chat({
      model: config.model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      temperature: CLASSIFIER_TEMPERATURE,
      responseFormat: "json",
    });
  } catch (error: unknown) {
    // A non-retryable client error (bad shape) is downgraded to a parse failure
    // so we do not crash the batch; retryable errors propagate for the queue.
    if (error instanceof IncoError && !error.retryable) {
      console.error(
        JSON.stringify({ event: "classify.llm.error", kind: error.kind, status: error.status }),
      );
      return { ok: false, reason: error.message };
    }
    throw error;
  }
  recordUsage(counters, result);
  return parseClassificationResponse(result.content);
}

/**
 * Remap a repair reply (numbered 0..n-1 over `missing`) back onto the original
 * batch indices. Out-of-range ordinals are dropped.
 */
function remapRepair(
  items: ReadonlyArray<ClassificationItem>,
  missing: ReadonlyArray<number>,
  batch: ReadonlyArray<ClassificationInputItem>,
): ReadonlyArray<ClassificationItem> {
  const remapped: ClassificationItem[] = [];
  for (const item of items) {
    const originalIndex = missing[item.index];
    if (originalIndex === undefined) continue;
    if (originalIndex < 0 || originalIndex >= batch.length) continue;
    remapped.push({ ...item, index: originalIndex });
  }
  return remapped;
}

/** Merge two classification lists by index, first-seen wins; out-of-range dropped. */
function mergeByIndex(
  length: number,
  first: ReadonlyArray<ClassificationItem>,
  second: ReadonlyArray<ClassificationItem>,
): ReadonlyArray<ClassificationItem> {
  const byIndex = new Map<number, ClassificationItem>();
  for (const item of [...first, ...second]) {
    if (item.index < 0 || item.index >= length) continue;
    if (!byIndex.has(item.index)) byIndex.set(item.index, item);
  }
  return [...byIndex.values()];
}

/** A canonical entity name paired with the raw mention it was derived from. */
interface CanonicalMention {
  readonly name: string;
  readonly mention: string;
}

/**
 * Canonicalize each item's raw mentions once, keeping the raw mention that maps
 * to each canonical name for audit. Deterministic; pure.
 */
function canonicalMentions(item: ReconciledItem): ReadonlyArray<CanonicalMention> {
  const byName = new Map<string, string>();
  for (const mention of item.entities) {
    const name = canonicalizeEntities([mention])[0];
    if (name === undefined || name === "") continue;
    if (!byName.has(name)) byName.set(name, mention);
  }
  return [...byName.entries()].map(([name, mention]) => ({ name, mention }));
}

/** Collect canonical entities across all reconciled items, with their aliases. */
function collectEntities(items: ReadonlyArray<ReconciledItem>): ReadonlyArray<EntityWrite> {
  const aliasesByName = new Map<string, Set<string>>();
  for (const item of items) {
    for (const { name, mention } of canonicalMentions(item)) {
      const set = aliasesByName.get(name) ?? new Set<string>();
      set.add(mention);
      aliasesByName.set(name, set);
    }
  }
  return [...aliasesByName.entries()].map(([name, aliases]) => ({
    name,
    aliases: [...aliases].sort(),
  }));
}

/** Link each classified item to its canonical entities (with raw mention). */
async function persistEntityLinks(
  databaseUrl: string,
  items: ReadonlyArray<ReconciledItem>,
  entityIdByName: ReadonlyMap<string, number>,
): Promise<void> {
  const links: Array<{ itemId: number; entityId: number; mention: string }> = [];
  for (const item of items) {
    for (const { name, mention } of canonicalMentions(item)) {
      const entityId = entityIdByName.get(name);
      if (entityId === undefined) continue;
      links.push({ itemId: item.id, entityId, mention });
    }
  }
  await linkItemEntities(databaseUrl, links);
}

/**
 * Recompute and persist cross-source cluster hints over the recent window.
 *
 * Always calls `saveClusters`, even when the window yields ZERO hints: that is
 * the "everything slid out of the window" case, and persistence must still clear
 * stale `cluster_id` stamps and mark old clusters inactive. Returns the number
 * of live clusters written.
 */
async function clusterRecentWindow(databaseUrl: string): Promise<number> {
  const candidates: ReadonlyArray<ClusterableItem> = await loadClusterCandidates(
    databaseUrl,
    CLUSTER_WINDOW,
  );
  const hints = clusterByGlobalTitleHash(candidates, { minDistinctSources: 2 });
  return saveClusters(databaseUrl, hints);
}

// Re-exported for the consumer wiring and tests.
export { unclassified };
