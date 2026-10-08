# Cloudflare Platform Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace keyword scoring with embedding-based matching (Workers AI + Vectorize), run scans as durable Workflows with Queue-backed indexing, then add Hyperdrive, spend-control and caching improvements, each phase shippable and switchable on its own.

**Architecture:** Neon stays the source of truth; Vectorize is a derived index (one namespace per workspace). Embeddings run through the Workers AI binding via AI Gateway and are recorded in the existing cost ledger. A `VANTAGE_SEMANTIC_MODE` switch (`off` | `shadow` | `on`) lets semantic scoring run beside keyword scoring before it changes any user-visible result. Workflows and Queue consumers live in plain `.mjs` files that call internal routes through `WORKER_SELF_REFERENCE`, preserving the single-bundle rule in `worker-entry.mjs`.

**Tech Stack:** Next 16 + OpenNext 1.20.8, Wrangler 4.147, Drizzle (neon-http, later optionally postgres.js via Hyperdrive), Vitest 5 (`pnpm test`), `node --test` for `test/worker-entry.test.mjs`, Cloudflare Workers AI, Vectorize, AI Gateway, Workflows, Queues, Hyperdrive.

**Spec:** the conversation proposal of 2026-10-08 (summarised in "Global Constraints" below); related existing docs: `docs/slices/S21-radar-scan-workflow.md` (a separate public-scan Workflow `RADAR_SCAN` that must share the Workflow export file created in Task 12), `docs/costs.md`, `worker-entry.mjs` header comment.

## Global Constraints

- Next.js in this repo has breaking changes: read the relevant guide in `node_modules/next/dist/docs/` before touching routes (AGENTS.md).
- Embedding model `@cf/qwen/qwen3-embedding-0.6b`: 1024 dimensions, cosine, 8,192 input tokens, $0.0118 per million input tokens.
- Vectorize limits: topK ≤ 50 with metadata/values, ≤ 100 without; upsert batch ≤ 1000 from Workers; ≤ 10 metadata indexes per index; metadata indexes must exist **before** vectors are inserted or filters will not match them; mutations are asynchronous (a just-upserted vector may not be queryable yet).
- Workflows: ≤ 1 MiB per step output, 10,000 steps default, instance IDs ≤ 100 chars matching `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$`.
- Queue messages ≤ 128 KB; send IDs, never document text.
- Hyperdrive caches reads for 60 s by default and never invalidates on write; budget, lease, switch, auth and read-after-write queries must use a cache-disabled config.
- Every vector query MUST pass `namespace: workspaceId`; no code path may query without it.
- The pipeline must degrade to keyword-only scoring when the `AI`/`VECTORIZE` bindings are absent or a call fails; a scan must never fail because of semantic features.
- Bindings are not inherited by `env.staging` / `env.production` in `wrangler.jsonc`; every binding is declared at top level and in both envs. Staging uses its own resource names (`-staging` suffix).
- Never import app source (`lib/**`) from `worker-entry.mjs` or `worker/**`; reach it through `WORKER_SELF_REFERENCE` with `Authorization: Bearer <CRON_SECRET>`.
- Next free migration number is **0020** (0016 through 0019 already exist; 0019 is the embedding-state and shadow migration). Re-check `ls drizzle/*.sql` and any merged #49 migration before generating.
- With `VANTAGE_SEMANTIC_MODE=off`, every indexing path returns before any AI or Vectorize call: the queued embed job, the profile-save fallback, and material indexing.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Execution Model

Subagents that implement or review tasks run on the `haiku` alias (Haiku 5.5, `claude-haiku-5-5`), per the user's instruction of 2026-10-08. Pass `model: "haiku"` on every `Agent` call; do not set `CLAUDE_CODE_SUBAGENT_MODEL`. Each delegation carries the task text, its file scope, and the validation command from the task's run steps. Tasks 14, 15, 17 and 18 touch concurrency and transactions: the main thread reviews those diffs itself before commit.

## Review Focus

- Empty or whitespace-only document text, and text over 8,192 tokens: skip empty (no embed call, no error); truncate long text to 6,000 characters before embedding.
- Vectorize eventual consistency: dedupe must compare vectors inside the current batch in memory and use Vectorize only for older documents, so a just-upserted neighbour that is not yet queryable cannot cause a duplicate opportunity.
- Cross-workspace leakage: a query for workspace A must never return workspace B's vectors, even when A has no vectors yet.
- AI or Vectorize outage / missing binding: semantic stage returns `null` signals and the scan completes on keyword scoring.
- Retried Workflow steps: re-running `collect`, `embed` or `build` for the same inputs must not duplicate documents, vectors or opportunities (the `document_workspace_hash_uidx` unique index and upsert-by-document-id vectors provide this; tests must prove it).
- A Workflow instance dying mid-scan must not lock the workspace forever (lease TTL expiry), and a double cron fire must not run two scans for one workspace slot.

---

## Phase 0: Preconditions (no code)

### Task 0: Baseline and operator prerequisites

**Files:** none (verification and human actions).

- [ ] **Step 1: Operator confirms housekeeping** (the user does these; the executor only checks and records the answers in the PR description): the two Cloudflare tokens pasted into chat in #34 are rolled; #41/#42 (Next/React, Drizzle) are merged before Task 15; #50 (README) is merged; #33 or #46 closed.
- [ ] **Step 2: Install and baseline**
  Run: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
  Expected: all green. Record the test count as the baseline.
- [ ] **Step 3: Operator creates Cloudflare resources** (run by the user; the executor prints these commands, never runs them):

```bash
npx wrangler vectorize create vantage-docs --dimensions=1024 --metric=cosine
npx wrangler vectorize create vantage-docs-staging --dimensions=1024 --metric=cosine
# before any vectors are inserted, for BOTH indexes:
npx wrangler vectorize create-metadata-index vantage-docs --property-name=kind --type=string
npx wrangler vectorize create-metadata-index vantage-docs --property-name=platform --type=string
npx wrangler vectorize create-metadata-index vantage-docs --property-name=postedAt --type=number
npx wrangler vectorize create-metadata-index vantage-docs-staging --property-name=kind --type=string
npx wrangler vectorize create-metadata-index vantage-docs-staging --property-name=platform --type=string
npx wrangler vectorize create-metadata-index vantage-docs-staging --property-name=postedAt --type=number
npx wrangler queues create vantage-embed-jobs && npx wrangler queues create vantage-embed-dlq
npx wrangler queues create vantage-embed-jobs-staging && npx wrangler queues create vantage-embed-dlq-staging
npx wrangler r2 bucket create vantage-artifacts && npx wrangler r2 bucket create vantage-artifacts-staging
```

  Also create an AI Gateway named `vantage` in the dashboard (caching on, logging on) and, if wanted, a dynamic route `draft-route`.
- [ ] **Step 4: Commit nothing.** This task has no diff.

---

## Phase 1: AI foundation and shadow-mode scoring

### Task 1: Bindings, vars and a typed env accessor

**Files:**
- Modify: `wrangler.jsonc` (top level, `env.staging`, `env.production`)
- Create: `lib/cf/env.ts`
- Test: `test/cf-env.test.ts`

**Interfaces:**
- Produces: `type AiBinding = { run(model: string, input: unknown, options?: unknown): Promise<unknown> }`; `type VectorizeBinding` with `upsert(vectors)`, `query(vector, opts)`, `deleteByIds(ids)` (shapes as in Cloudflare's `VectorizeIndex`, declared structurally); `getAi(): Promise<AiBinding | null>`; `getVectorize(): Promise<VectorizeBinding | null>`; `getSemanticMode(): "off" | "shadow" | "on"` (reads `process.env.VANTAGE_SEMANTIC_MODE`, anything unrecognised is `"off"`).

- [ ] **Step 1: Write failing tests** in `test/cf-env.test.ts`: `getSemanticMode` returns `"off"` for undefined, `"bogus"`, and returns `"shadow"` / `"on"` for those values; `getAi()` returns `null` when `getCloudflareContext` throws or `env.AI` lacks a `run` function, and returns the binding when it has one (mock `@opennextjs/cloudflare` with `vi.mock`, same pattern as `test/public-guard.test.ts`); same two cases for `getVectorize()` keyed on `query` being a function.
- [ ] **Step 2: Run** `pnpm vitest run test/cf-env.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement `lib/cf/env.ts`** following the structural-guard style of `getRateLimiter` in `lib/public/guard.ts`; log only the error name on failure.
- [ ] **Step 4: Edit `wrangler.jsonc`**: add `"ai": { "binding": "AI" }`, `"vectorize": [{ "binding": "VECTORIZE", "index_name": "vantage-docs" }]` (staging: `vantage-docs-staging`), and `"vars": { "VANTAGE_SEMANTIC_MODE": "off" }` at top level and production, `"shadow"` in staging, in all three places.
- [ ] **Step 5: Run** `pnpm vitest run test/cf-env.test.ts && pnpm typecheck` — expect PASS.
- [ ] **Step 6: Commit** `feat: declare AI and Vectorize bindings with a typed accessor`.

### Task 2: Price rows and the embedding client

**Files:**
- Modify: `lib/costs/prices.ts` (append to `DEFAULT_PRICES`)
- Create: `lib/embeddings/embed.ts`, `test/helpers/fake-ai.ts`
- Test: `test/embed.test.ts`

**Interfaces:**
- Consumes: `getAi()` (Task 1); `recordCost` from `lib/costs/ledger.ts`; `getUnitCost(provider, action)` from `lib/costs/prices.ts`.
- Produces: `EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b"`; `EMBEDDING_DIMENSIONS = 1024`; `embedTexts(texts: string[], ctx: { workspaceId?: string; sourceKey: string; signal?: AbortSignal }): Promise<number[][] | null>` (returns `null`, never throws, when the binding is absent or the call fails; output is index-aligned with the input; empty/whitespace inputs are not sent and yield a zero-length array `[]` at their index); `createFakeAi(opts)` in `test/helpers/fake-ai.ts` returning `{ binding, calls }` where each text maps deterministically to a vector (hash-seeded) and `opts.throws` / `opts.dim` are supported.

- [ ] **Step 1: Failing tests** in `test/embed.test.ts`: (a) returns vectors index-aligned for 3 texts using the fake binding and passes `{ gateway: { id: "vantage" } }` as the third `run` argument; (b) a blank text at index 1 is not sent (fake `calls` contain 2 texts) and result[1] is `[]`; (c) 150 texts are split into batches of at most 64 per `run` call; (d) text longer than 6,000 characters is truncated to 6,000 before sending; (e) binding throwing returns `null` and does not throw; (f) with no binding returns `null`; (g) a cost row is recorded with `provider: "workers_ai"`, `action: "embed_m_tokens"`, units = estimated tokens / 1e6 where tokens = `ceil(chars / 4)` (mock `recordCost`).
- [ ] **Step 2: Run** `pnpm vitest run test/embed.test.ts` — expect FAIL.
- [ ] **Step 3: Add price row** `{ provider: "workers_ai", action: "embed_m_tokens", unitCostUsd: 0.0118, unit: "million tokens", notes: "Workers AI qwen3-embedding-0.6b $0.0118/M input tokens. Source: https://developers.cloudflare.com/workers-ai/models/qwen3-embedding-0.6b/ ; checked 2026-10-08" }`. Update `test/cost-prices.test.ts` expectations only if it counts rows.
- [ ] **Step 4: Implement `embedTexts`** reading `response.data` (array of vectors) from the `run` result; validate each vector length equals `EMBEDDING_DIMENSIONS` else treat the call as failed.
- [ ] **Step 5: Run** `pnpm vitest run test/embed.test.ts test/cost-prices.test.ts` — expect PASS.
- [ ] **Step 6: Commit** `feat: embedding client with cost ledger recording`.

### Task 3: Vectorize wrapper with enforced namespaces

**Files:**
- Create: `lib/embeddings/store.ts`, `test/helpers/fake-vectorize.ts`
- Test: `test/vector-store.test.ts`

**Interfaces:**
- Consumes: `getVectorize()` (Task 1).
- Produces: `type VectorKind = "doc" | "profile" | "material"`; `upsertVectors(workspaceId: string, items: Array<{ id: string; values: number[]; kind: VectorKind; platform?: string; postedAt?: number }>): Promise<boolean>`; `queryVectors(workspaceId: string, vector: number[], opts: { kind: VectorKind; topK: number; minScore?: number }): Promise<Array<{ id: string; score: number; postedAt?: number }>>` (empty array when binding absent or on failure); `deleteVectors(workspaceId: string, ids: string[]): Promise<boolean>`; `createFakeVectorize()` doing in-memory cosine with namespace isolation and honouring `filter: { kind }`.

- [ ] **Step 1: Failing tests**: (a) a vector upserted for workspace A is not returned by a query for workspace B; (b) a query for a workspace with no vectors returns `[]`; (c) `kind` filter excludes other kinds; (d) `minScore` drops lower scores; (e) upserts above 1000 items are chunked into batches of 1000; (f) empty `workspaceId` throws before touching the binding; (g) binding errors yield `false` / `[]` and do not throw.
- [ ] **Step 2: Run** `pnpm vitest run test/vector-store.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the wrapper; it is the only module allowed to call `VECTORIZE` (add a grep test in the same file like `test/browser-run.test.ts` line 308 does for `BROWSER`).
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat: namespaced Vectorize store wrapper`.

### Task 4: Migration 0019 — embedding state and shadow table

**Files:**
- Modify: `lib/db/schema.ts` (`document` gets `embeddingModel text`, `embeddedAt timestamptz`; new table `semanticShadow`)
- Create: `drizzle/0019_*.sql` (generated), `drizzle/meta/*` (generated)
- Test: extend `test/schema-contract.test.ts`

**Interfaces:**
- Produces: `semanticShadow` table: `id uuid pk`, `workspaceId uuid fk`, `documentId uuid fk`, `keywordRung int`, `semanticRung int null`, `semanticFit real null`, `anchorSimilarity real null`, `mode text`, `createdAt timestamptz`; unique index on `(documentId, mode)`. Partial index `document_unembedded_idx` on `document(workspace_id) where embedded_at is null`.

- [ ] **Step 1: Failing test** in `test/schema-contract.test.ts` asserting the new columns/table exist on the exported schema objects.
- [ ] **Step 2: Run** `pnpm vitest run test/schema-contract.test.ts` — expect FAIL.
- [ ] **Step 3: Edit schema, then** `pnpm db:generate`; confirm the generated file is numbered 0019 and contains only these changes.
- [ ] **Step 4: Run** `pnpm vitest run test/schema-contract.test.ts && pnpm typecheck` — expect PASS.
- [ ] **Step 5: Operator applies the migration to the staging Neon branch** (not production). Executor prints the command and stops.
- [ ] **Step 6: Commit** `feat: embedding state columns and semantic shadow table`.

### Task 5: Index the monitoring profile and pending documents

**Files:**
- Create: `lib/embeddings/index-profile.ts`, `lib/embeddings/index-documents.ts`
- Test: `test/index-profile.test.ts`, `test/index-documents.test.ts`

**Interfaces:**
- Consumes: `embedTexts` (Task 2), `upsertVectors`/`deleteVectors` (Task 3), `document`/`monitoringProfile` tables, `normalizeDocument` from `lib/pipeline/normalize.ts`.
- Produces: `profileTexts(profile: MonitoringProfileInput): string[]` (pure: product description, target customer, each topic, and `"alternative to <competitor>"` for each competitor; blanks removed); `indexProfile(workspaceId: string, profileId: string, version: number, profile: MonitoringProfileInput): Promise<{ indexed: number; skipped?: "unavailable" }>` (vector id `profile:${profileId}:${n}`, kind `profile`, deletes the previous version's ids first); `embedPendingDocuments(workspaceId: string, opts: { limit: number; signal?: AbortSignal }): Promise<{ embedded: number; skipped?: "unavailable" }>` (selects documents `where embedded_at is null` ordered by `collected_at desc`, embeds `normalizeDocument(doc).text`, upserts kind `doc` with `platform` and `postedAt` ms, then sets `embedding_model` and `embedded_at`; documents whose normalised text is empty are marked embedded without a vector so they are not retried forever).

- [ ] **Step 1: Failing tests**: `profileTexts` golden output for a sample profile including blank competitor; `indexProfile` upserts N vectors with ids `profile:<id>:0..N-1` and deletes the old version's ids; `embedPendingDocuments` with the fake AI/Vectorize and a mocked db marks rows embedded, skips empty-text docs without calling the AI, is a no-op returning `skipped: "unavailable"` when `embedTexts` returns `null` (rows stay unembedded), and running twice embeds nothing the second time (idempotent).
- [ ] **Step 2: Run** `pnpm vitest run test/index-profile.test.ts test/index-documents.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** both modules; db access through `getDb()` like `lib/profile/repository.ts`.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat: index monitoring profiles and pending documents`.

### Task 6: Semantic signals (anchors, fit, rung)

**Files:**
- Create: `lib/pipeline/anchors.ts`, `lib/pipeline/semantic.ts`
- Test: `test/semantic-signal.test.ts`

**Interfaces:**
- Consumes: `embedTexts`, `queryVectors`.
- Produces: `ANCHORS: Array<{ rung: 1 | 2 | 3 | 4; text: string }>` (at least 4 phrases per rung, written in the register of real posts; include "anything better than Mention for tracking HN?" as rung 3); `SEMANTIC_THRESHOLDS = { anchor: 0.6, fit: 0.5, duplicate: 0.92 }` (provisional; calibrated in Task 8); `type SemanticSignal = { documentId: string; fit: number; rung: number | null; anchorSimilarity: number | null }`; `loadAnchorVectors(): Promise<Array<{ rung: number; values: number[] }> | null>` (module-level memo; `null` when embedding unavailable; does not memoise failures); `semanticSignals(workspaceId: string, docs: Array<{ id: string; vector: number[] }>): Promise<Map<string, SemanticSignal> | null>` where `fit` is the best cosine to any `kind: "profile"` vector (query topK 3), and `rung`/`anchorSimilarity` come from the nearest anchor computed in memory, with `rung = null` when similarity is below `SEMANTIC_THRESHOLDS.anchor`; `cosine(a: number[], b: number[]): number` exported.

- [ ] **Step 1: Failing tests**: `cosine` known values (identical = 1, orthogonal = 0, zero vector = 0, mismatched length throws); with the fake AI making an anchor and a document map to the same vector, `semanticSignals` yields that anchor's rung and similarity 1; a document far from all anchors yields `rung: null`; `fit` equals the top profile score and is 0 when the workspace has no profile vectors; returns `null` when AI unavailable; `loadAnchorVectors` calls the embed binding once across two invocations.
- [ ] **Step 2: Run** `pnpm vitest run test/semantic-signal.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Anchors are embedded in one `embedTexts` call and memoised in module scope.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat: semantic fit and intent-rung signals`.

### Task 7: Shadow mode in the opportunity build

**Files:**
- Modify: `lib/opportunities/run.ts` (inside `buildOpportunities`, after documents are normalised and before clustering)
- Create: `lib/pipeline/shadow.ts`
- Test: `test/semantic-shadow.test.ts`

**Interfaces:**
- Consumes: `getSemanticMode()`, `embedPendingDocuments`, `semanticSignals`, `classifyIntent`, `semanticShadow` table.
- Produces: `recordShadow(workspaceId: string, docs: NormalizedDocument[], signals: Map<string, SemanticSignal>, mode: "shadow" | "on"): Promise<number>` (inserts rows with `onConflictDoNothing` on `(documentId, mode)`); `runSemanticStage(workspaceId: string, docs: NormalizedDocument[], signal?: AbortSignal): Promise<Map<string, SemanticSignal> | null>` — no-op returning `null` when mode is `"off"`; otherwise embeds pending documents, loads the vectors it needs, computes signals, records shadow rows, returns the map. Must never throw (catch, log error name, return `null`).

- [ ] **Step 1: Failing tests**: mode `off` makes no AI call and returns `null`; mode `shadow` inserts one row per document carrying `keywordRung` from `classifyIntent` and the semantic values; an AI outage returns `null` and `buildOpportunities` still returns its normal result; repeated runs do not duplicate shadow rows; in shadow mode the opportunity rows produced are identical to mode `off` (the map is not passed to scoring yet).
- [ ] **Step 2: Run** `pnpm vitest run test/semantic-shadow.test.ts test/opportunity-queue.test.ts` — expect FAIL on the new file only.
- [ ] **Step 3: Implement** `runSemanticStage` and call it once from `buildOpportunities`, ignoring the result for scoring.
- [ ] **Step 4: Run** `pnpm test` — expect PASS with the baseline count plus new tests.
- [ ] **Step 5: Commit** `feat: semantic shadow mode in the opportunity build`.

### Task 8: Calibration report

**Files:**
- Create: `scripts/semantic-calibrate.ts`, `docs/semantic-scoring.md`
- Test: `test/semantic-calibrate.test.ts`

**Interfaces:**
- Produces: `summarizeShadow(rows: Array<{ keywordRung: number; semanticRung: number | null; semanticFit: number | null; anchorSimilarity: number | null }>): { total: number; agree: number; semanticHigher: number; semanticLower: number; noSemantic: number; fitP50: number; fitP90: number }` (pure, exported from the script file); the script reads `semantic_shadow` for a workspace id argument and prints the summary plus the 20 largest disagreements (title, both rungs).

- [ ] **Step 1: Failing test** for `summarizeShadow` with a hand-built table (counts and percentiles asserted exactly).
- [ ] **Step 2: Run** `pnpm vitest run test/semantic-calibrate.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the pure function and the CLI wrapper (`pnpm tsx scripts/semantic-calibrate.ts <workspaceId>`); write `docs/semantic-scoring.md` explaining modes, thresholds, how to read the report, and the rule: move production to `shadow`, review the report on at least 200 real documents, adjust `SEMANTIC_THRESHOLDS`, then `on`.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `feat: shadow-mode calibration report`.

### Task 9: Semantic scoring in `on` mode

**Files:**
- Modify: `lib/pipeline/intent-ladder.ts`, `lib/opportunities/features.ts` (`computeFeatures` gains an optional third parameter), `lib/opportunities/run.ts`, `lib/learning/signals.ts` only if it breaks
- Test: extend `test/opportunity-queue.test.ts`; create `test/intent-semantic.test.ts`

**Interfaces:**
- Consumes: `SemanticSignal` (Task 6).
- Produces: `classifyIntent(doc: NormalizedDocument, semantic?: SemanticSignal | null): IntentResult` — with no signal the output is byte-identical to today; with a signal, `intentRung = max(keywordRung, semantic.rung ?? 0)`, confidence is the larger of the keyword confidence and `min(0.95, semantic.anchorSimilarity)` when the semantic rung won, `reason` becomes `"semantic match to <rung label>"` when it won, and `factors.semantic = { rung, anchorSimilarity, fit }`; `computeFeatures(docs, profile, semantic?: Map<string, SemanticSignal> | null)` uses `fit = max(tokenFit, max over docs of semantic.fit)` when present.

- [ ] **Step 1: Failing tests** in `test/intent-semantic.test.ts`: the post "anything better than Mention for tracking HN?" with a rung-3 semantic signal and no keyword match for its phrasing scores rung 3; a keyword rung 4 is never lowered by a rung 2 semantic signal; `classifyIntent(doc)` with no signal equals the previous result for 6 fixture documents (snapshot values copied from current behaviour before editing); `computeFeatures` fit uses the larger of token fit and semantic fit.
- [ ] **Step 2: Run** `pnpm vitest run test/intent-semantic.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; in `buildOpportunities` pass the map from `runSemanticStage` into scoring only when `getSemanticMode() === "on"`.
- [ ] **Step 4: Run** `pnpm test` — expect PASS; existing tests unchanged.
- [ ] **Step 5: Commit** `feat: blend semantic signals into intent and fit scoring`.

### Task 10: Semantic near-duplicate clustering

**Files:**
- Create: `lib/pipeline/dedupe.ts`
- Modify: `lib/opportunities/run.ts` (before `clusterDocuments`)
- Test: `test/dedupe.test.ts`

**Interfaces:**
- Produces: `nearDuplicates(items: Array<{ id: string; vector: number[]; postedAt: number | null }>, threshold?: number): Map<string, string>` — maps each id to its canonical id (earliest `postedAt`, ties by id), using in-memory pairwise cosine ≥ `SEMANTIC_THRESHOLDS.duplicate`, transitive via union-find; ids with no neighbour map to themselves; `olderNeighbours(workspaceId: string, item: { id: string; vector: number[] }, opts: { before: number; threshold?: number }): Promise<string[]>` querying Vectorize for kind `doc` and returning ids above the threshold (excluding itself and excluding results newer than `before`).
- In `buildOpportunities`, when mode is `on`, documents mapped to the same canonical id are collapsed into one group before key-based clustering; their evidence rows are all kept.

- [ ] **Step 1: Failing tests**: three vectors where A≈B≈C (≥ threshold) collapse to one canonical (the earliest); a non-neighbour stays alone; transitivity A–B, B–C with A–C below threshold still groups all three; ties choose the lexicographically smaller id; `olderNeighbours` excludes the item itself and results with `postedAt` later than `before`; with `VECTORIZE` absent returns `[]`.
- [ ] **Step 2: Run** `pnpm vitest run test/dedupe.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** and wire into `run.ts` behind mode `on`. Do not rely on Vectorize to see documents upserted in the same run (Review Focus).
- [ ] **Step 4: Run** `pnpm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: collapse near-duplicate discussions across platforms`.

### Task 11: Grounded drafting from relevant material and evidence

**Files:**
- Create: `lib/drafting/ground.ts`
- Modify: `lib/drafting/generate.ts` (`DraftInput` gains optional `materialChunks?: string[]`; the 800-character slice is used only when it is absent), `lib/drafting/repository.ts` (call `selectGrounding` where `DraftInput` is assembled, around line 87 and 208), `app/api/profile/route.ts` (call `indexMaterial` after a profile save, best-effort)
- Test: `test/ground.test.ts`, extend `test/drafting.test.ts`

**Interfaces:**
- Produces: `chunkText(text: string, opts?: { size?: number; overlap?: number }): string[]` (defaults 1200 / 150 characters, splits on paragraph then sentence boundaries, drops blanks); `indexMaterial(workspaceId: string, profileId: string, text: string): Promise<number>` (vector ids `material:${profileId}:${i}`, kind `material`, chunk text kept in Neon? **No** — the chunk text is regenerated from `productMaterialText` by `chunkText`, so the vector id's index maps back deterministically); `selectGrounding(workspaceId: string, productMaterialText: string, profileId: string, threadText: string, k?: number): Promise<string[] | null>` (default k = 4; returns `null` when unavailable so callers fall back); `rankEvidence<T extends { documentId: string }>(workspaceId: string, threadVector: number[] | null, evidence: T[], limit: number): Promise<T[]>` (keeps order when vectors are unavailable).

- [ ] **Step 1: Failing tests**: `chunkText` of a 3,000-character text yields chunks ≤ 1,200 characters with 150-character overlap and no empty chunk; `selectGrounding` returns the chunk whose vector is closest to the thread vector (fake AI/Vectorize); returns `null` with no bindings; `generateGroundedDraft` with `materialChunks` uses them and not the first 800 characters; without it, output equals today's (existing tests unchanged).
- [ ] **Step 2: Run** `pnpm vitest run test/ground.test.ts test/drafting.test.ts` — expect FAIL on new tests.
- [ ] **Step 3: Implement**; `rankEvidence` uses doc vectors already in Vectorize only through `queryVectors` with the thread vector, never fetching by id.
- [ ] **Step 4: Run** `pnpm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: ground drafts on relevant product material`.

### Task 12: Route model calls through AI Gateway

**Files:**
- Modify: `lib/drafting/contribution.ts` (`modelJson`, lines ~82-110: endpoint and key selection)
- Test: extend `test/contribution-model-routing.test.ts`

**Interfaces:**
- Produces: `resolveModelEndpoint(env: NodeJS.ProcessEnv): { url: string; key: string | undefined }` — when `CF_AIG_BASE_URL` is set (value like `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat`) returns `${CF_AIG_BASE_URL}/chat/completions` with key `CF_AIG_TOKEN`; otherwise today's endpoint and key unchanged.

- [ ] **Step 1: Read** `lib/drafting/contribution.ts` lines 82-110 and note the current endpoint literal.
- [ ] **Step 2: Failing tests**: with `CF_AIG_BASE_URL` unset the resolved URL and key are exactly today's; with it set the gateway URL and `CF_AIG_TOKEN` are used; the allow-list of verified models (line ~122) still rejects unknown models; model names in the request body are unchanged.
- [ ] **Step 3: Run** `pnpm vitest run test/contribution-model-routing.test.ts` — expect FAIL on new tests.
- [ ] **Step 4: Implement** `resolveModelEndpoint` and use it in `modelJson`. Record `CF_AIG_BASE_URL` and `CF_AIG_TOKEN` in `.env.example` and `lib/env/required.ts` as optional.
- [ ] **Step 5: Run** `pnpm test` — expect PASS.
- [ ] **Step 6: Commit** `feat: optional AI Gateway routing for draft models`.

**Phase 1 exit gate (operator):** deploy to staging with mode `shadow`; run Task 8's report; only then set production to `shadow`, and later `on`.

---

## Phase 2: Workflow scan pipeline

### Task 13: Run-scoped scan lease

**Files:**
- Modify: `lib/cron/lease.ts`
- Test: extend `test/scan-lease.test.ts`

**Interfaces:**
- Produces: `claimScanLease(workspaceId: string, ttlMinutes: number): Promise<string | null>` (returns the token, or `null` when another lease is live); `releaseScanLease(workspaceId: string, token: string): Promise<void>` (releases only when the token matches); existing `withWorkspaceScanLease` keeps its signature and behaviour and is reimplemented on top of the two functions with a 5-minute TTL.

- [ ] **Step 1: Failing tests**: a second claim while live returns `null`; a claim after TTL expiry succeeds; release with a wrong token leaves the lease in place; `withWorkspaceScanLease` still throws `"Workspace scan already running."` on contention (existing tests pass untouched).
- [ ] **Step 2: Run** `pnpm vitest run test/scan-lease.test.ts` — expect FAIL on new tests.
- [ ] **Step 3: Implement** by extracting the update statements already in `lease.ts`.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `refactor: split scan lease into claim and release`.

### Task 14: Internal scan step routes

**Files:**
- Create: `app/api/internal/scan/due/route.ts`, `.../plan/route.ts`, `.../collect/route.ts`, `.../embed/route.ts`, `.../build/route.ts`, `.../finish/route.ts`, `lib/cron/steps.ts`
- Test: `test/scan-steps.test.ts`

**Interfaces:**
- Consumes: `isCronAuthorized`, `claimScanLease`/`releaseScanLease` (Task 13), `scanNotDueReason` (export it from `lib/cron/scan.ts`), `runCollector`, `collectorsByType`, `embedPendingDocuments`, `buildOpportunities`.
- Produces (all `POST`, JSON, 401 without the cron bearer, `runtime = "nodejs"`, `dynamic = "force-dynamic"`):
  - `due` → `{ workspaceIds: string[] }`, cadence-filtered, ordered by `updatedAt`, at most 200.
  - `plan` `{ workspaceId }` → `{ skipped: true, reason }` or `{ leaseToken, sourceIds: string[] }` (claims a 30-minute lease; requires a monitoring profile; up to `MAX_SOURCES_PER_SCAN = 40` eligible sources ordered by `lastPolledAt asc nulls first`; returns 409 `{ error: "scan already running" }` when the lease is held).
  - `collect` `{ workspaceId, sourceId }` → `{ inserted, skipped, switchedOff? }`; HTTP 502 when the collector reports an error (so the Workflow step retries), 404 for an unknown source (non-retryable).
  - `embed` `{ workspaceId }` → `{ embedded }`; always 200 (semantic failures are not scan failures).
  - `build` `{ workspaceId }` → the `buildOpportunities` result.
  - `finish` `{ workspaceId, leaseToken }` → `{ released: true }`.
  - `lib/cron/steps.ts` holds the shared body of each (so routes stay thin) and the `scanWorkspace` function keeps working for `/api/cron/tick` and `/api/pipeline/run`.

- [ ] **Step 1: Failing tests** in `test/scan-steps.test.ts`: every route returns 401 without `Authorization: Bearer <CRON_SECRET>`; `plan` returns the lease token and ≤ 40 source ids, returns 409 while a lease is held, and returns `skipped` when no profile exists or the workspace is not due; `collect` returns 502 when `runCollector` reports an error and 404 for an unknown source; `collect` called twice for the same source inserts no duplicate documents (mock db unique-conflict behaviour as `test/collector-runner.test.ts` does); `finish` with the wrong token does not release.
- [ ] **Step 2: Run** `pnpm vitest run test/scan-steps.test.ts` — expect FAIL.
- [ ] **Step 3: Read** `node_modules/next/dist/docs/` route-handler guidance, then implement. Do not remove or change the existing `tick` route.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` — expect PASS.
- [ ] **Step 5: Commit** `feat: internal per-step scan routes`.

### Task 15: Scan Workflow orchestration (pure) and class wrapper

**Files:**
- Create: `worker/scan-run.mjs`, `worker/workflows.mjs`
- Modify: `worker-entry.mjs` (re-export workflow classes; `scheduled` creates instances), `wrangler.jsonc` (workflow + env bindings in all three places)
- Test: extend `test/worker-entry.test.mjs`; create `test/scan-run.test.mjs`

**Interfaces:**
- Produces: `runScan(params: { workspaceId: string }, step: { do: Function }, call: (path: string, body: object) => Promise<Response>): Promise<{ status: "skipped" | "done" | "partial"; failures: number }>` in `worker/scan-run.mjs`: step `plan` (a `skipped` result ends the run; 409 ends the run as skipped without throwing); then `Promise.all` over `collect:<sourceId>` steps each with `{ retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" }` where a collect step that exhausts its retries is caught and counted in `failures` (one bad source never fails the run); then steps `embed`, `build` (retries limit 2, timeout "5 minutes"); and a `finish` step always executed in a `finally`. Step return values are small JSON (counts and ids).
- `worker/workflows.mjs` exports `class ScanWorkspace extends WorkflowEntrypoint` whose `run(event, step)` builds `call` from `this.env.WORKER_SELF_REFERENCE` and `this.env.CRON_SECRET` and delegates to `runScan`; 409 responses are returned unchanged so `runScan` can treat lease contention as skipped; other non-2xx responses throw `NonRetryableError` for 4xx (except 409 and 429) and a plain `Error` otherwise. It is the shared Workflow export file that S21's `RadarScan` will join.
- `scheduled(controller, env)` (when `env.SCAN` exists): `call` the `due` route, then for each workspace `env.SCAN.create({ id: "scan-" + workspaceId + "-" + slot, params: { workspaceId } })` inside `Promise.allSettled`, where `slot = yyyymmddHH` of `controller.scheduledTime`; an "already exists" rejection is counted as skipped, any other rejection is logged and rethrown after all attempts. When `env.SCAN` is absent it keeps the existing tick behaviour (so rollout is a config switch). Wrangler: `"workflows": [{ "name": "vantage-scan", "binding": "SCAN", "class_name": "ScanWorkspace" }]` (staging `vantage-scan-staging`), keeping cron arrays as they are.

- [ ] **Step 1: Failing tests** in `test/scan-run.test.mjs` with a fake `step` that runs callbacks inline and records names/options: run order is `plan` → all `collect:*` → `embed` → `build` → `finish`; a `skipped` plan result runs nothing else and does not call `finish`; 409 from `plan` ends as skipped; one collect step that throws (after the fake step's retries are exhausted) yields `status: "partial", failures: 1` and `build` and `finish` still run; `finish` runs even when `build` throws, and the throw propagates; collect steps are launched concurrently (fake step records overlap). In `test/worker-entry.test.mjs`: with `env.SCAN` present, `scheduled` calls `due` then `create` once per workspace with the id format above and tolerates one "already exists" rejection; with `env.SCAN` absent the existing tick tests still pass unchanged.
- [ ] **Step 2: Run** `node --test test/scan-run.test.mjs test/worker-entry.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** `runScan`, the wrapper class and the `scheduled` branch. In the same step confirm in the Workflows docs how duplicate instance IDs surface from `create` and adjust the "already exists" detection to the documented error.
- [ ] **Step 4: Run** `node --test test/scan-run.test.mjs test/worker-entry.test.mjs && pnpm test && pnpm typecheck` — expect PASS. Then `pnpm cf:build && npx wrangler deploy --dry-run --env staging --outdir .wrangler/dry` — expect no config errors.
- [ ] **Step 5: Commit** `feat: scan as a durable Workflow with per-source steps`.

**Phase 2 exit gate (operator):** deploy to staging; confirm a cron-created instance shows one `collect:*` step per source in the dashboard and that a deliberately failing source retries without failing the run; only then enable on production by deploying with the `workflows` binding present (rollback = remove the binding; the tick path resumes).

---

## Phase 3: Queues for indexing

### Task 16: Embed queue producer and consumer

**Files:**
- Create: `worker/queue.mjs`, `app/api/internal/embed/backfill/route.ts`, `lib/cf/queue.ts`
- Modify: `worker-entry.mjs` (export `queue`), `wrangler.jsonc` (producers, consumers, DLQ in all three places), `app/api/profile/route.ts` and `app/api/sources/route.ts` (best-effort enqueue)
- Test: `test/queue-consumer.test.mjs`, `test/enqueue.test.ts`

**Interfaces:**
- Produces: message shapes `{ type: "index-profile", workspaceId, profileId } | { type: "backfill-documents", workspaceId }`; `enqueueEmbedJob(message): Promise<boolean>` in `lib/cf/queue.ts` (returns `false` when `EMBED_QUEUE` is absent or `send` throws; never throws); `handleQueue(batch, env): Promise<void>` in `worker/queue.mjs` that, per message, POSTs to `/api/internal/embed/backfill` via `WORKER_SELF_REFERENCE` with the cron bearer, calls `message.ack()` on 2xx or a 4xx other than 401 and 429 (401 can mean a `CRON_SECRET` mismatch, so it is retried), and `message.retry({ delaySeconds: 30 * message.attempts })` otherwise; the route re-reads the profile or documents from Neon (messages carry IDs only) and calls `indexProfile` / `indexMaterial` / `embedPendingDocuments({ limit: 200 })`. Wrangler: producer binding `EMBED_QUEUE` → `vantage-embed-jobs`; consumer `max_batch_size: 10`, `max_retries: 3`, `max_concurrency: 2`, `dead_letter_queue: "vantage-embed-dlq"` (staging names with `-staging`).

- [ ] **Step 1: Failing tests**: `handleQueue` acks on 200, acks on 404, retries on 500 with `delaySeconds` of `30 * attempts`, retries on 429, and processes every message even if one retries; `enqueueEmbedJob` returns `false` with no binding and `false` (not a throw) when `send` rejects; the profile route still succeeds when the queue is absent.
- [ ] **Step 2: Run** `node --test test/queue-consumer.test.mjs` and `pnpm vitest run test/enqueue.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; the backfill route is idempotent (upserts, and `embedded_at is null` filtering).
- [ ] **Step 4: Run** `pnpm test && node --test test/queue-consumer.test.mjs test/worker-entry.test.mjs && pnpm typecheck` — expect PASS; dry-run deploy as in Task 15.
- [ ] **Step 5: Commit** `feat: queue-backed profile and document indexing`.

---

## Phase 4: Hyperdrive (gated on measurement)

### Task 17: Database driver seam and benchmark

**Files:**
- Modify: `lib/db/client.ts`, `package.json` (add `postgres`), `wrangler.jsonc` (`HYPERDRIVE` cached and `HYPERDRIVE_FRESH` cache-disabled, all three places; `placement.region: "aws:us-east-1"` only for the benchmark branch)
- Create: `scripts/db-bench.ts`, `docs/hyperdrive.md`
- Test: `test/db-client.test.ts`

**Interfaces:**
- Produces: `getDb()` keeps its synchronous signature and today's behaviour by default. With `VANTAGE_DB_DRIVER=hyperdrive` and a `HYPERDRIVE_FRESH` binding present it returns a Drizzle `postgres-js` instance bound to `env.HYPERDRIVE_FRESH.connectionString`, created per request context (never cached on `globalThis`, per Hyperdrive guidance); `getReadDb()` returns the cached-config instance for public read pages and equals `getDb()` when Hyperdrive is off; `withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>` throws `"Transactions require the Hyperdrive driver"` on neon-http.
- `scripts/db-bench.ts` runs the 12 queries a typical scan issues (list sources, upsert lease, 50 document selects, budget reserve) N times against a given driver and prints p50/p95 per query and total.

- [ ] **Step 1: Failing tests**: default env returns the neon-http instance (existing behaviour); driver flag without a binding falls back to neon-http with one warning; with a fake binding the postgres-js path is chosen and two calls return distinct instances; `withTransaction` throws on neon-http.
- [ ] **Step 2: Run** `pnpm vitest run test/db-client.test.ts` — expect FAIL.
- [ ] **Step 3: Implement the seam.** Operator then creates Hyperdrive configs (`wrangler hyperdrive create vantage-fresh --connection-string=<neon direct url> --caching-disabled` and a cached one) and runs `scripts/db-bench.ts` on staging with each driver, with and without `placement`; results go in `docs/hyperdrive.md`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` — expect PASS.
- [ ] **Step 5: Commit** `feat: switchable Hyperdrive database driver with benchmark`.
- **Gate:** continue to Task 18 only if the benchmark shows a meaningful scan-time win (record the numbers) or transactions are wanted for Task 18. Otherwise stop Phase 4 here and leave the flag off.

### Task 18: Atomic budget reservation

**Files:**
- Modify: `lib/providers/paid-call.ts`
- Test: extend `test/paid-provider-call.test.ts`

**Interfaces:**
- Produces: behaviour change only when `withTransaction` is available: reserve and settle each run inside one transaction with `select ... for update` on `provider_budget_day`, removing the `reservation_ref` serialisation and the "blocked until reconciled" state; with neon-http the current implementation is untouched. Public signature of `runPaidCall` is unchanged.

- [ ] **Step 1: Failing tests** (with a fake transactional db): two concurrent calls both complete and the day total equals the sum of settled costs; a work failure settles at the estimate and does not block later calls; a ledger-record failure keeps the reservation and denies the result until reconciliation, as `runPaidCall` does today, because the provider call has already spent money.
- [ ] **Step 2: Run** `pnpm vitest run test/paid-provider-call.test.ts` — expect FAIL on new tests; existing neon-http tests stay green.
- [ ] **Step 3: Implement** the branch behind the same driver flag.
- [ ] **Step 4: Run** `pnpm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: transactional budget reservation under Hyperdrive`.

---

## Phase 5: Smaller additions (each independent, each optional)

### Task 19: Browser Run artifacts in R2

**Files:**
- Modify: `wrangler.jsonc` (`r2_buckets`: `ARTIFACTS` → `vantage-artifacts`, staging `-staging`), `lib/browser/run.ts` (screenshot path only)
- Create: `lib/r2/artifacts.ts`
- Test: `test/artifacts.test.ts`

**Interfaces:**
- Produces: `putArtifact(key: string, body: ArrayBuffer | string, contentType: string): Promise<string | null>` (returns the key or `null` when `ARTIFACTS` is absent or the put fails); `artifactKey(workspaceId: string, kind: "screenshot" | "snapshot", id: string): string` → `${workspaceId}/${kind}/${id}`. `browserScreenshot` stores the image when a workspace id is supplied and returns the key alongside its existing result without changing existing fields. Only `lib/r2/artifacts.ts` touches `ARTIFACTS` (grep test).

- [ ] **Step 1: Failing tests**: key format; absent binding returns `null`; fake bucket receives the bytes and content type; existing `test/browser-run.test.ts` still passes.
- [ ] **Step 2: Run** `pnpm vitest run test/artifacts.test.ts test/browser-run.test.ts` — expect FAIL on the new file.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat: store Browser Run screenshots in R2`.

### Task 20: Page cache for public pages (after #47/#49 merge)

**Files:**
- Modify: `open-next.config.ts` (R2 incremental cache using the `ARTIFACTS`-style bucket `vantage-cache`), `wrangler.jsonc`, public page modules from #47/#49 (add `revalidate`)
- Test: `pnpm cf:build` output check

- [ ] **Step 1: Precondition:** #47 and #49 are merged; list their public routes in this task's PR description.
- [ ] **Step 2: Read** the OpenNext Cloudflare caching docs (R2 incremental cache override, `NEXT_INC_CACHE_R2_BUCKET` binding name) and apply them to `open-next.config.ts`; keep authenticated pages `force-dynamic`.
- [ ] **Step 3: Verify:** `pnpm cf:build` succeeds and a staging request to one public page returns a cache hit on the second request (record the header or log evidence in the PR).
- [ ] **Step 4: Commit** `feat: R2 incremental cache for public pages`.

### Task 21: KV read-through cache for prices and switches (conditional)

**Files:**
- Create: `lib/kv/cache.ts`
- Modify: `lib/costs/prices.ts` (`getUnitCost`), `lib/sources/switch.ts`
- Test: `test/kv-cache.test.ts`

**Interfaces:**
- Produces: `kvGet(key: string): Promise<string | null>`, `kvPut(key: string, value: string, ttlSeconds: number): Promise<void>` (both never throw; absent binding behaves as a permanent miss). Prices use TTL 60 s; switches use TTL 30 s (KV is eventually consistent, so a kill switch can take up to about a minute to reach every location; document this in `docs/sources`). Neon remains authoritative and a KV miss reads Neon then writes back; `getSourceSwitch` must never return a value older than the TTL.
- **Condition:** do this task only if staging metrics show price/switch lookups materially contributing to query volume; otherwise skip and note "skipped, no measured benefit" in the PR.

- [ ] **Step 1: Failing tests**: miss falls through to Neon and writes back; hit avoids the Neon call; absent binding behaves as before; stale-after-TTL read refetches.
- [ ] **Step 2: Run** `pnpm vitest run test/kv-cache.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: KV read-through cache for prices and source switches`.

### Task 22: Durable Object spend gate (conditional)

**Files:**
- Create: `worker/budget-gate.mjs` (`BudgetGate` Durable Object, SQLite-backed), wrangler `durable_objects` and `migrations` entries
- Modify: `lib/providers/paid-call.ts`
- Test: `test/budget-gate.test.mjs`

**Interfaces:**
- Produces: DO methods `reserve(estimateUsd: number, capUsd: number): { ok: boolean; ref?: string }`, `settle(ref: string, costUsd: number): void`, `sweep(): number` (expires reservations older than 10 minutes). One object per UTC day (`idFromName(day)`). Parallel paid calls are allowed (the one-at-a-time rule is replaced by summed outstanding reservations ≤ cap).
- **Condition:** build this only if Task 18 was skipped or parallel paid calls are needed; with Hyperdrive transactions the DO is redundant. State which in the PR.

- [ ] **Step 1: Failing tests** (fake storage): two concurrent reservations both succeed when their sum ≤ cap and the second fails when it would exceed it; `settle` releases the difference; expired reservations are swept; settling an unknown ref is a no-op.
- [ ] **Step 2: Run** `node --test test/budget-gate.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement**; Neon `cost_event` stays the ledger of record.
- [ ] **Step 4: Run** `node --test test/budget-gate.test.mjs && pnpm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: Durable Object budget gate`.

### Task 23: Situation classifier reuse (after #49 merges)

**Files:** the #49 situation-classifier module (path to be recorded when #49 merges); `lib/pipeline/anchors.ts`.

- [ ] **Step 1: Precondition:** #49 merged. Read its classifier and list its keyword rules.
- [ ] **Step 2:** Write tests that a post with no keyword hit but an embedding match to a labelled situation anchor is classified correctly, and that classifier output without embeddings is unchanged.
- [ ] **Step 3:** Add situation anchors beside `ANCHORS` and blend using the same pattern as Task 9 (`max` of keyword and semantic result, semantic only when above the anchor threshold).
- [ ] **Step 4: Run** `pnpm test` — expect PASS. **Step 5: Commit** `feat: semantic situation classification`.

---

## Self-Review

- **Coverage:** Workers AI + Vectorize (Tasks 1-11), AI Gateway/routing (Tasks 2, 12), Workflows (13-15), Queues (16), Hyperdrive incl. cache-disabled config and transactions (17-18), R2 (19-20), KV (21), Durable Objects (22), #49 classifier (23). The wrangler Browser/rate-limit fix is already done and committed separately.
- **Types:** `SemanticSignal`, `SEMANTIC_THRESHOLDS`, `embedTexts`, `queryVectors`, `upsertVectors`, `getSemanticMode`, `claimScanLease`/`releaseScanLease` are defined once and referenced with the same names in later tasks.
- **Known open points the executor must resolve by reading docs, not guessing:** duplicate Workflow instance-ID error shape (Task 15), OpenNext R2 cache binding name (Task 20), Wrangler syntax for Hyperdrive `localConnectionString` in dev (Task 17).
