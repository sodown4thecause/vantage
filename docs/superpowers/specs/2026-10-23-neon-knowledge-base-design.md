# Neon knowledge base: v2 design and migration gate

**Status:** Draft for review. This change is the design, an unnumbered schema DDL file and synthetic contract tests only. Liam has authorised this design revision, not the final design, runtime implementation or any migration. PR #112 stays draft until Liam approves the design and the Captain approves a migration number against then-current main.

## What changed in this revision

Keyword search now uses built-in PostgreSQL full-text search: a generated `tsvector` column with a GIN index, queried with `websearch_to_tsquery` and ranked with `ts_rank_cd`. Neon rejected `pg_search` as deprecated and no longer allowed on the isolated probe branch, so the `pg_search` prerequisite is removed. No extension is added for keyword search, and there is no fallback service.

The earlier provisional `0032` migration, its snapshot and its journal entry are removed, so `drizzle/` and `lib/db/schema.ts` match the PR base. The KB DDL now lives in `docs/superpowers/specs/2026-10-23-neon-knowledge-base-schema.sql`, which Drizzle never reads and which carries no migration number.

## What this draft proves

The scope rule is enforced by a CHECK constraint: an approved global row has a null workspace, and a private row has a workspace. The contract tests run that exact predicate in Node's in-memory SQLite against synthetic positive and negative rows. The read-boundary SQL in this document returns only approved rows visible to the authorised workspace, and the same SQLite harness runs it against synthetic rows. Static contract tests check that the DDL declares `halfvec(1024)` embeddings, a generated `tsvector` with a GIN index, an HNSW cosine index and no `CREATE EXTENSION` statement. The executable Drizzle schema and migration journal are unchanged from the PR base, so the migration drift gate is unaffected.

## What this draft does not prove

- PostgreSQL execution of the DDL, the `tsvector` expression, the GIN or HNSW indexes, or the `halfvec` type. SQLite contracts are not PostgreSQL execution proof.
- Any keyword or vector retrieval, ranking quality, RRF behaviour, recall, citation validity or cross-workspace leakage on live data. No evaluation has run.
- That pgvector is available on Neon for this project. Reason's earlier isolated probe reported pgvector 0.8.6 verified; this revision does not repeat that probe.
- Ingestion, embedding, provider calls, credits or cost.

## Scope and boundaries

Use one Neon database and the existing `public` schema only; do not add a third schema or database. Keep the KB separate from opportunity-scoring embeddings, which remain Workers AI Qwen3 plus Cloudflare Vectorize. KB reads will be tenant-scoped and read-only, return citations, or explicitly say no source was found. Vantage never posts, comments, votes, submits, or sends lists on anyone's behalf.

This draft does not implement ingestion, embedding calls, search queries, `search_insights`, an approval UI, refresh jobs, evaluation data, or a backfill. No provider calls or secrets are used.

## Data contract

- `kb_documents` stores source URL, optional title and publication time, capture time, curation tier (`A`–`D`), hub (`gtm`, `seo-geo`, `content`, `coding`, or `community-rules`), scope, approval state, nullable `workspace_id`, and content hash. A null `workspace_id` is allowed only for approved global material. Private rows require a non-null workspace; a database check constraint enforces both rules. Workspace deletion cascades to private material.
- `kb_chunks` stores ordered, heading-aware passages, contextual header, source text, chunker version, and content hash. Hash the full text sent to the embedder, including its contextual prefix; re-embed only when that hash or the chunker version changes.
- `tsv` is a generated `tsvector` over the header and text using the `simple` configuration, with a GIN index. PostgreSQL maintains it, so application code never writes it.
- Embeddings use `jina-embeddings-v5-text-small` as `halfvec(1024)`, with `retrieval.passage` for documents and `retrieval.query` for queries, and an HNSW cosine index (`halfvec_cosine_ops`). The embedding column stays nullable until a chunk is embedded.
- Chunk order is unique within each document. Document indexes support workspace, hub, publication time, and source lookups. All KB tables and indexes live in `public`.

## Retrieval plan (after approval, not implemented)

1. Keyword candidates are the top 40 chunks matching `websearch_to_tsquery('simple', $query)` against `tsv`, ordered by `ts_rank_cd(tsv, query)`. Vector candidates are the top 40 by `halfvec` cosine distance to the query embedding. Combine the two rankings with reciprocal rank fusion (RRF, `k=60`) and return the top eight. There is no compulsory reranker.
2. Evaluation is not run. It needs 50 human-labelled questions held privately in growth-wiki. Mean recall@8 must be at least 90%, valid citations 100%, and cross-workspace leakage zero. Trial `jina-reranker-v3` only if recall@8 fails, and record both the gain and the latency.
3. Use Tako first and Linkup second, only to refresh approved sources. Linkup may create provenance-bearing proposed sources and quarantined research, but may not set approval flags or write trusted global chunks. Liam approves new monthly sources before ingestion. Store an empty URL list when citations cannot be resolved. Cache query plus parameters for 24 hours. Linkup standard search is $0.005; deep search is $0.05 and only behind `toolApproval`.
4. Chunk by heading at roughly 400–800 tokens with approximately 15% overlap. Prefix title, section, date, and tier before hashing and embedding. Batch Jina requests, retry transient failures, and record provider usage through the existing cost ledger. Do not add a key or make provider calls in this draft.
5. Apply hub, `since`, and workspace filters. Global approved documents may be shared; private documents are visible only to their owning workspace. The retrieval implementation must prove this boundary in tests.
6. Add `search_insights({ query, hub?, since? })` only after approval. Answers cite source URLs or explicitly state that no source was found.

## Migration gate

The DDL needs pgvector for `halfvec` and the HNSW index. It needs no other extension: `tsvector`, GIN and the text-search functions are built into PostgreSQL. No extension SQL or remote database operation is run in this revision.

Before any migration, in order, and none of which is executed here:

1. Liam approves the revised design, and the Captain approves a migration number and a rebase against then-current main.
2. Create a disposable Neon branch from the intended base. Verify its branch and endpoint IDs are not main, staging or production before connecting. Use the direct endpoint for migrations and never print credentials.
3. Enable pgvector only on that branch, record the installed version, and stop on rejection.
4. Generate the migration with Drizzle at that point from the schema, apply it on the disposable branch, and verify the generated column, GIN and HNSW indexes, the scope constraint and workspace visibility. Record the evidence, suspend the compute and arrange cleanup.
5. Liam separately approves the final design and any target migration. This test is never approval to migrate main, staging or production.

The KB DDL carries no migration number. At approval, Drizzle generates the migration against then-current main, which assigns the next free number, its snapshot and its journal entry. The KB claims no number now. Never hand-edit generated metadata or add placeholder migrations.

## Read boundary (executed against SQLite)

The later reader must enforce `approved = true` and either global scope with a null workspace or private scope with exactly the authorised workspace ID, before both candidate retrieval paths and citation lookup. Never accept a workspace ID from a tool argument instead of the authorised context. The query below uses `$1` for the authorised workspace. It describes the later reader, not a deployed query, and no new query or mutation is introduced here.

```sql
SELECT id FROM kb_documents
WHERE approved = true AND (
  (scope = 'global' AND workspace_id IS NULL)
  OR (scope = 'private' AND workspace_id = $1)
)
ORDER BY id
```

The contract tests run this query and the scope constraint in Node's in-memory SQLite against synthetic rows. They prove the predicate logic only. They do not prove PostgreSQL behaviour, full-text ranking, vectors or a runtime reader.

## Ingest permissions

Ingest permissions, provenance-bearing proposed sources and quarantined research need an approval design before implementation. The default `approved = false` cannot create trusted global material, and Linkup cannot set approval or write trusted global chunks. This draft does not claim that ingest permissions are implemented.

## Data handling

The 50 human-labelled questions and any research datasets remain private in growth-wiki when authorised. Only synthetic fixtures belong in the public repository. Opportunity embeddings, Workers AI bindings, billing, auth, wrangler and observability remain unchanged.
