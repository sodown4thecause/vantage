# GTM Ingest — AI Developer Tools Market Monitor

Foundational ingestion pipeline. Tracks the AI developer-tools market from
RSS/Atom feeds and JSON APIs, normalizes everything into one schema, and stores
deduplicated records in Neon Postgres.

Runtime: **Cloudflare Workers** + **Cloudflare Queues** + **Neon Postgres**
(serverless HTTP driver).

```
cron (*/5 min)                queue                     consumer
┌────────────────┐   enqueue  ┌──────────────────┐  batch  ┌──────────────────────┐
│ runPoller      │ ─────────▶ │ gtm-ingest-jobs  │ ──────▶ │ fetch → normalize →  │
│ (enqueue only) │  per due   │  (+ DLQ)         │         │ dedup → write Neon   │
└────────────────┘  source    └──────────────────┘         └──────────────────────┘
```

The cron handler **never** fetches upstream. It syncs the registry mirror and
enqueues one message per due source. Fetching/parsing happens only in the queue
consumer, so the fast trigger path stays fast and each source retries independently.

---

## Layout

| Path | Purpose |
|------|---------|
| `wrangler.toml` | cron trigger, queue producer + consumer, DLQ, vars |
| `src/types.ts` | shared trusted types + queue contract |
| `src/registry/seed.ts` | the seed source registry (config, not code) |
| `src/registry/index.ts` | parse/expand registry, fail-loud validation, `findSource` |
| `src/poller.ts` | cron → due selection → `sendBatch` |
| `src/consumer.ts` | queue handler: fetch → normalize → dedup → write |
| `src/fetcher.ts` | conditional GET, per-source User-Agent, API key injection |
| `src/normalizer.ts` | RSS/Atom/JSON → common shape, canonical URL + hashing |
| `src/db.ts` | Neon serverless driver queries + idempotent inserts |
| `src/index.ts` | Worker entry: scheduled + queue + small HTTP surface |
| `migrations/0001_init.sql` | `sources`, `items`, `jobs` schema |
| `migrations/0002_signal_layer.sql` | classification/entity/cluster schema |
| `migrations/0003_signal_layer_fixes.sql` | `classification_status`, `clusters.inactive_since` |
| `scripts/migrate.mjs` | apply migrations to Neon over HTTP |
| `scripts/smoke.ts` | pure-logic tests (no network/DB); run with `npm run smoke` |

> The signal-layer modules (`src/classify/*`, `src/entities/*`, `src/inco/*`) are
> documented in the **Signal layer** section below.

---

## Deploy

```bash
npm install

# 1) Create the queue + dead-letter queue (once per account)
npx wrangler queues create gtm-ingest-jobs
npx wrangler queues create gtm-ingest-jobs-dlq

# 2) Provide secrets
npx wrangler secret put DATABASE_URL          # Neon pooled conn string, sslmode=require
npx wrangler secret put MANUAL_TRIGGER_TOKEN  # bearer token for /trigger and /signals
npx wrangler secret put EDGAR_USER_AGENT      # e.g. "GTM-Monitor/0.1 (you@example.com)"
npx wrangler secret put STACKEXCHANGE_KEY     # optional; raises quota 300/day -> 10k/day
npx wrangler secret put INCO_API_KEY          # required for the signal layer (see "Signal layer")

# 3) Apply the schema
$env:DATABASE_URL="postgres://..."; npm run migrate

# 4) Ship it
npm run deploy
```

Run locally: `npm run dev` (cron and queues both simulate locally).

Verify pure logic without any network/DB: `npm run smoke` (uses `tsx`).

> **Types:** `tsconfig.json` relies on `@cloudflare/workers-types` and the hand-written
> `Env` in `src/types.ts`. `npm run cf-typegen` (`wrangler types`) is available if you
> want generated binding types, but the generated `worker-configuration.d.ts` is
> intentionally **not** included in `tsconfig.json` — its `Env` would collide with the
> authoritative hand-written one. Wire it in deliberately if you adopt it.

---

## Adding a source (no code changes)

Edit `src/registry/seed.ts`:

- **Plain feed** — add an entry with `url`.
- **Template** — add an entry with a `urlTemplate` containing `{tokens}` and an
  `expand` array of `{ token: value }` rows. Each row becomes one concrete source
  with a stable id like `template-id:slug`. To add a competitor query, append to
  the relevant array (`GOOGLE_NEWS_QUERIES`, `STACKOVERFLOW_TAGS`, `NPM_PACKAGES`, …).

On the next cron tick the poller syncs the registry into the `sources` table
(never clobbering etag/lastPolledAt) and starts polling new entries.

---

## Testing one source manually

```bash
curl -X POST https://gtm-ingest.<subdomain>.workers.dev/trigger/google-news:ai-developer-tool \
  -H "Authorization: Bearer $MANUAL_TRIGGER_TOKEN"
```

Response is the poll outcome (`status`, `itemCount`, `dedupedCount`, …). Inspect
the registry with `GET /sources`, liveness with `GET /health`.

Expansion ids are `template-id:slug`, e.g. `stackoverflow-tag:cursor`,
`npm-downloads:langchain`, `google-news:ai-developer-tool`.

---

## Known constraints baked in

| Source | Constraint | Implementation |
|--------|-----------|----------------|
| SourceForge | ≤ 1 req / feed / 30 min, serial | captured as the pattern for slow feeds; no bulk scraping |
| SEC EDGAR | descriptive UA required, ≤ 10 req/sec | `EDGAR_USER_AGENT`; `RATE_EDGAR` policy |
| Google News | poll no faster than ~15 min | `RATE_GOOGLE_NEWS`, 20-min interval |
| Stack Exchange API | 300/day keyless, 10k/day with key | `STACKEXCHANGE_KEY` injected only when present |
| Default | 20-min poll interval | `DEFAULT_POLL_INTERVAL_MINUTES` + per-source override |

**Explicitly not built:** G2/Capterra/GetApp/SoftwareAdvice scraping, Product Hunt
GraphQL API (Atom feed used instead), SourceForge bulk scraping, and the Grok X
scanner. (Classification, entity resolution, and cross-source clustering now
exist — see **Signal layer** below.)

**Grok/X seam:** `POST /signals/:sourceId` accepts an array of signals (or
`{ items: [...] }`), enqueues an `ingest-signal` queue message, and runs them
through the same normalizer + `items` table + dedup path. No schema change needed
to add it later.

- **Seed the source first.** The Grok scanner MUST be seeded as a registry source
  (an entry in `src/registry/seed.ts`) before `/signals` will accept its
  `sourceId`. Signals posted to an unknown source are rejected with `404`, exactly
  like an unknown poll target — the consumer also fails loud on unknown ids.
- **Boundary contract.** Each posted item is parsed at the boundary; items missing
  a non-empty `title` or `url` are dropped and counted. A request is capped at 50
  signals, and accepted signals are chunked across multiple `Queue.send` calls so
  each message stays under the 128 KB queue limit. The response reports
  `{ accepted, rejected, enqueued }`.

---

## Deduplication

Three layers, from cheapest to most durable:

1. **Canonicalization** (`canonicalizeUrl`) — scheme is forced to `https`, a
   leading `www.` is dropped, percent-encoding is normalized, a trailing slash is
   removed, and query params are sorted. Only the industry-standard tracking set
   (`utm_*`, `fbclid`, `gclid`) is stripped globally; `ref`/`source` are
   **per-source opt-in** (`stripParams` on a source) because they are meaningful
   query keys on many sites.
2. **In-batch dedup** (`dedupeBatch`) — duplicates are collapsed in application
   code *before* the single `unnest` INSERT is built (keyed on `canonical_url`
   first, then `title_hash`), then `ON CONFLICT DO NOTHING` is the DB backstop.
   A single `unnest` INSERT is not guaranteed to catch two identical rows inside
   the same statement, so the app-side pass closes that gap.
3. **Cross-source dedup — DEFERRED.** The same article arriving via Google News,
   a vendor blog, and Hacker News is *not* collapsed yet. The `global_title_hash`
   column (sha-256 of the normalized title alone, source-unscoped, with a
   non-unique index) now exists and is populated so the
   **classification/entity-resolution phase** can join on it without an expensive
   backfill. The per-source `title_hash` behavior is unchanged.

`http:` is upgraded to `https:` as the pragmatic default (the vast majority of
feeds serve https, and it collapses the common scheme-variant duplicate). A rare
http-only host would canonicalize to a different scheme than its origin; exclude
or special-case it at the registry layer if one appears.

---

## Signal layer

The signal layer adds three advisory enrichments on top of ingest, all
**decoupled from the fetch path** so LLM latency/cost can never fail ingest:

1. **Batched LLM classification** (`src/classify/*`) — labels, entities,
   relevance, and a short reason per item.
2. **Entity resolution** (`src/entities/aliases.ts`) — deterministic
   canonicalization of the raw mentions the model suggests.
3. **Cross-source clustering** (`src/entities/cluster.ts`) — non-destructive
   "multi-source echo" hints over a sliding window.

### Layout

| Path | Purpose |
|------|---------|
| `src/classify/handler.ts` | queue handler: load → chunk → classify → repair → persist → cluster |
| `src/classify/schema.ts` | zod validation of untrusted model output (the boundary) |
| `src/classify/prompt.ts` | prompt text + `CLASSIFIER_PROMPT_VERSION` |
| `src/classify/batch.ts` | pure chunking / reconcile / repair-index validation |
| `src/classify/config.ts` | parse `CLASSIFIER_*` env into a trusted config |
| `src/classify/write-policy.ts` | pure mirror of the version-keyed write guard |
| `src/entities/aliases.ts` | alias map + canonicalization (source of truth) |
| `src/entities/cluster.ts` | pure grouping + membership lifecycle |
| `src/inco/client.ts` | OpenAI-compatible chat client (`https://api.inco.ai/v1`) |
| `migrations/0002_signal_layer.sql` | classification/entity/cluster schema |
| `migrations/0003_signal_layer_fixes.sql` | `classification_status`, `clusters.inactive_since` |

### How batched classification works

Ingest inserts items, then enqueues one `classify-batch` message per chunk of
inserted ids onto the **separate** `gtm-classify-jobs` queue (`wrangler.toml`).
The consumer for that queue runs `classifyBatch(env, itemIds)`, which:

1. **Guards**: if `CLASSIFIER_ENABLED=false` or `INCO_API_KEY` is absent, it
   acks immediately and does no work (never an error — a config choice must not
   retry).
2. **Loads only unclassified ids** (`where classified_at is null`) — the
   idempotency guard, so a re-delivered message costs nothing.
3. **Chunks** the rows by `CLASSIFIER_BATCH_SIZE`, capped at
   `CLASSIFIER_MAX_ITEMS_PER_MESSAGE` per message.
4. For each batch, calls the model with `CLASSIFIER_MAX_CONCURRENCY` in flight,
   validates the reply with zod, and — on missing/invalid indices — makes ONE
   bounded **repair** call for just the missing indices. A repair reply whose
   index set is not a clean subset of `{0..missing-1}` (an original-batch
   position, a duplicate, or an extra) is rejected wholesale: a misnumbered reply
   must never label the wrong row. Anything still missing falls back to a
   well-formed `unclassified`.
5. Canonicalizes + upserts entities and links them, then persists classifications
   in one batched `UPDATE`.
6. Recomputes cross-source clusters over the recent window.

### Classification env vars

| Var | Default | Meaning |
|-----|---------|---------|
| `CLASSIFIER_ENABLED` | `"true"` | Master switch. `"false"` disables all LLM work. |
| `INCO_CLASSIFIER_MODEL` | `"deepseek-v4.1-flash"` | Classifier model id. |
| `INCO_WRITER_MODEL` | `"kimi-k3"` | Writer model id (reserved seam, later phase). |
| `CLASSIFIER_BATCH_SIZE` | `15` | Items per LLM call. |
| `CLASSIFIER_MAX_ITEMS_PER_MESSAGE` | `60` | Hard cap of items classified per queue message (cost guardrail). |
| `CLASSIFIER_MAX_CONCURRENCY` | `2` | Max concurrent in-flight LLM calls per message. |

Non-secret vars live in `wrangler.toml` `[vars]`; the model ids were verified
against `GET https://api.inco.ai/v1/models` on 2026-10-07.

### Disabling and the API key

- **Disable entirely**: set `CLASSIFIER_ENABLED = "false"` (in `wrangler.toml` or
  as an env var). The consumer then produces no `classify-batch` messages at all,
  and any in-flight message acks without calling the model.
- **API key**: `INCO_API_KEY` is a **secret**, read **only** from
  `env.INCO_API_KEY`. Set it with:

  ```bash
  npx wrangler secret put INCO_API_KEY
  ```

  It is placed only in the `authorization: Bearer …` request header; it is never
  logged, never embedded in error messages, and never returned to callers (see
  `src/inco/client.ts`).

### Entity-resolution design

- **The alias map is the source of truth.** `canonicalizeEntity` /
  `canonicalizeEntities` (`src/entities/aliases.ts`) deterministically map a raw
  mention (e.g. `claude-code`, `@anthropic`) to a canonical name. Resolution never
  asks the model to decide identity.
- **The LLM only suggests.** The classifier returns raw `entities` mentions copied
  from the text; those are canonicalized in app code. The `entities.aliases` column
  stores the raw variants that resolved to a canonical name, for audit/coverage.
- **Deterministic write.** `upsertEntities` merges the app-computed alias set with
  the stored set using `array(select distinct unnest(entities.aliases ||
  excluded.aliases))` — a plain ordered form, chosen over a correlated
  `array_agg(distinct …)` subquery for determinism and verifiability.

### Cross-source clustering (non-destructive hint)

- A cluster is **only** formed when the same `global_title_hash` appears across
  **≥ 2 distinct source ids**; same-source repeats never cluster.
- Clustering is a **hint**: rows are never deleted or merged, and each item keeps
  its own id. `clusters` + `cluster_members` record the grouping and each member
  item is stamped with `cluster_id`.
- **Eventually consistent across a sliding window.** The candidate window is the
  most recent 2000 items (`order by id desc limit 2000`). When a cluster stops
  being emitted (its members slide out), persistence **clears** the stale
  `cluster_id` on its members and marks the `clusters` row `inactive_since`; if it
  re-forms, `inactive_since` is cleared. Clearing is scoped by *live cluster id*
  (an item is unstamped exactly when its cluster is no longer corroborated),
  bounded by the number of live clusters rather than the window size.

### Version-keyed re-classification policy

Classification is keyed on `classifier_version` (currently
`CLASSIFIER_PROMPT_VERSION`):

- **New items are always classified** (`classified_at is null`).
- **Already-classified items are only re-classified on an explicit version bump.**
  The write guard is
  `classified_at is null OR classifier_version is distinct from <incoming version>`,
  so a stale/re-delivered writer cannot clobber a newer classification
  (first-writer-wins), while a deliberate version change overwrites. Versions are
  treated as **opaque tokens**, not a linear order — `is distinct from` is
  sufficient for this policy. Bump `CLASSIFIER_PROMPT_VERSION` (or clear
  `classifier_version`) to mark rows stale.
- `classification_status` records the OUTCOME (`classified` | `unclassified`) so a
  transient parse-failure row can be re-attempted later without a full version
  bump (its `classified_at` is still stamped, which prevents immediate re-billing).

### Sweeping `unclassified` rows

`classification_status` distinguishes a real result from a parse-failure fallback,
so failed rows can be swept and re-attempted:

```sql
-- Inspect
select count(*) from items where classification_status = 'unclassified';

-- Reset failed rows so the next classify-batch re-attempts only those.
update items
set classified_at = null,
    classification_status = null
where classification_status = 'unclassified' and classifier_version = 'v1';
```

Then re-enqueue `classify-batch` messages for the reset ids (the handler loads
`classified_at is null`). Reset is scoped to a single `classifier_version` so a
recent failure is not re-billed against a version you are about to retire.

---

## Workers runtime limitations → design choices

1. **No TCP sockets → Neon HTTP driver.** `pg` cannot run in a Worker. All DB
   access goes through `@neondatabase/serverless`'s `neon()` HTTP function. The
   304/short-poll path and batch inserts are single HTTP round-trips.
2. **Cron has a limited execution budget.** So the trigger only syncs + enqueues;
   fetching/parsing happens in the consumer where per-message retries and batch
   concurrency scale independently.
3. **`webcrypto` only.** Hashing uses `crypto.subtle` (no `node:crypto` hashing).
4. **Queues require a paid plan.** `wrangler.toml` declares producer + consumer +
   DLQ; local dev simulates both.
5. **Sub-request limits per invocation.** Large source counts are chunked into
   `sendBatch` calls of ≤ 100 messages, and each consumer message handles exactly
   one source (one upstream fetch, one DB write).
6. **No filesystem at runtime.** Migrations run from a script (`scripts/migrate.mjs`)
   over the HTTP driver, not from inside the Worker.

## Ambiguities flagged

- **SEC EDGAR full-text search** is documented as
  `https://efts.sec.gov/LATEST/search-index?q=...`; the JSON response shape has
  changed over time. The adapter reads `hits.hits[]._source` defensively and
  falls back to an EDGAR search URL when no accession id is present. Verify the
  live shape before relying on parsed fields.
- **`rsshub` access method** is declared and handled as a feed, but no rsshub
  instance is seeded (self-hosting was out of scope). Add a `url` under `rsshub`
  to use it.
- **YouTube / AlternativeTo** entries expand from placeholder values
  (`UC-placeholder-*`). Replace with real channel ids / slugs to activate — until
  then they will fetch and simply return no items.
- **Per-host serial rate limiting** is enforced via per-source intervals and a
  ≤10 req/sec EDGAR policy. Because queue consumers run concurrently, a truly
  strict global host rate limiter would need a Durable Object; this pass relies on
  interval spacing, which is sufficient at the seeded source count.

## Deliberate scope boundaries (and their trigger points)

These are known, intentional gaps — not oversights. Each names the point at which
it must be addressed:

1. **No global per-host rate limiter / no Durable Object.** Politeness is enforced
   by per-source `poll_interval_minutes` plus a per-source `minIntervalSeconds`
   floor. Because queue consumers run concurrently, this is *not* a hard global
   cap on requests to a single host. **Trigger:** revisit when the registry scales
   past **~100 sources** or when many sources share one host — at that point add a
   Durable Object (or equivalent coordination) that serializes per-host requests.
2. **SSRF latent risk.** Source URLs come from the config registry, which is
   treated as trusted operator input, and the fetcher does not restrict the
   destination host/IP. This is safe only while the registry is code-reviewed
   config. **Trigger:** the moment the registry becomes remotely editable (an
   admin API/UI, a DB-driven source table, or accepting URLs from the Grok
   scanner), add a destination allow/deny policy — block private/link-local
   ranges and non-http(s) schemes, and validate redirect targets.
