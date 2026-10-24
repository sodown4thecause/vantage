# Neon knowledge base: v2 design and migration gate

**Status:** Draft for review; this change is schema and design only. It remains blocked on Liam's approval and a decision for the unavailable `pg_search` extension. Do not implement ingestion or retrieval, apply a production migration, or mark the PR ready until those blockers are resolved.

## Scope and boundaries

Use one Neon database and the existing `public` schema only; do not add a third schema or database. Keep the KB separate from opportunity-scoring embeddings, which remain Workers AI Qwen3 plus Cloudflare Vectorize. KB reads will be tenant-scoped and read-only, return citations, or explicitly say no source was found. Vantage never posts, comments, votes, submits, or sends lists on anyone's behalf.

This draft does not implement ingestion, embedding calls, search queries, `search_insights`, an approval UI, refresh jobs, evaluation data, or a backfill. No provider calls or secrets are used.

## Data contract

- `kb_documents` stores source URL, optional title and publication time, capture time, curation tier (`A`–`D`), hub (`gtm`, `seo-geo`, `content`, `coding`, or `community-rules`), scope, approval state, nullable `workspace_id`, and content hash. A null `workspace_id` is allowed only for approved global material. Private rows require a non-null workspace; a database check constraint enforces both rules. Workspace deletion cascades to private material.
- `kb_chunks` stores ordered, heading-aware passages, contextual header, source text, chunker version, and content hash. Hash the full text sent to the embedder, including its contextual prefix; re-embed only when that hash or the chunker version changes.
- Use `jina-embeddings-v5-text-small` with `halfvec(1024)`, `retrieval.passage` and `retrieval.query`, and an HNSW cosine index (`halfvec_cosine_ops`).
- The generated `tsv` value is a language-neutral representation of each header and passage. The requested keyword path is Neon `pg_search` BM25, alongside pgvector; the BM25 index is keyed by chunk UUID and covers header and text. The extension must be available on an isolated Neon branch before this migration can be applied.
- Chunk order is unique within each document. Document indexes support workspace, hub, publication time, and source lookups. Keep all KB tables and indexes in `public`.

## Retrieval and ingestion plan (after approval)

1. Retrieve up to 40 keyword and 40 vector candidates, combine rankings with reciprocal rank fusion (RRF, `k=60`), and return the top eight. There is no compulsory reranker. Evaluate on 50 human-labelled questions: mean recall@8 must be at least 90%, valid citations 100%, and cross-workspace leakage zero. Trial `jina-reranker-v3` only if recall@8 fails, and record both the gain and latency.
2. Use Tako first and Linkup second, only to refresh approved sources. Linkup may create provenance-bearing proposed sources and quarantined research, but may not set approval flags or write trusted global chunks. Liam approves new monthly sources before ingestion. Store an empty URL list when citations cannot be resolved. Cache query plus parameters for 24 hours. Linkup standard search is $0.005; deep search is $0.05 and only behind `toolApproval`.
3. Chunk by heading at roughly 400–800 tokens with approximately 15% overlap. Prefix title, section, date, and tier before hashing and embedding. Batch Jina requests, retry transient failures, and record provider usage through the existing cost ledger. Do not add a key or make provider calls in this draft.
4. Apply hub, `since`, and workspace filters. Global approved documents may be shared; private documents are visible only to their owning workspace. The retrieval implementation must prove this boundary in tests.
5. Add `search_insights({ query, hub?, since? })` only after approval. Answers cite source URLs or explicitly state that no source was found.

## Isolated extension check and migration gate

The extension check ran only on the isolated Neon branch `kb-extensions-probe-issue-103-pr-112`, created from `main`; neither `main` nor `staging` was changed. `CREATE EXTENSION IF NOT EXISTS vector VERSION '0.8.6'` succeeded and was verified as version 0.8.6. Neon rejected `CREATE EXTENSION IF NOT EXISTS pg_search` with “extension \"pg_search\" is deprecated and no longer allowed.” The probe compute is suspended. Do not apply the current BM25 migration to any branch until the keyword-search design is resolved; v2 explicitly requests `pg_search`, so this draft does not silently substitute a GIN fallback.

For any later supported extension test, create an isolated branch first, enable the required extensions there, verify their versions, then apply the migration only on that isolated branch. Never run this test or migration on `main` or `staging`. PR #96 has merged and owns migration 0031. The KB schema and scope migrations are now numbered 0032 and 0033, respectively, after the latest `main` migration journal was refreshed.

The schema contract tests cover nullability, the global/private constraint, chunk ordering, vector dimensions, and index definitions. Local checks cover lint, typecheck, and Vitest. The DDL has not been applied to Neon; only the isolated extension statements above were attempted.
