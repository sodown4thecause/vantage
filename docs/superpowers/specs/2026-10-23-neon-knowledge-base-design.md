# Neon knowledge base: design and migration gate

**Status:** Draft for review. This milestone adds the design and database contract only; implementation waits for Liam's approval.

## Scope

Keep the new knowledge base separate from Vantage's existing opportunity-scoring embeddings. The current Workers AI Qwen3 embeddings and Cloudflare Vectorize data remain unchanged. Neon is the system of record for curated knowledge documents and their chunks; search will be read-only and must return source URLs or say that no source was found. Vantage never posts, comments, or votes on anyone's behalf.

This draft does not implement ingestion, embedding calls, search queries, the `search_insights` tool, the source review UI, a refresh job, eval data, or a backfill. It does not connect to Neon or apply a migration. Do not build those pieces until Liam approves this design and migration.

## Data contract

- `kb_documents` stores a source URL, optional title and publication time, capture time, curation tier (`A`–`D`), hub (`gtm`, `seo-geo`, `content`, `coding`, or `community-rules`), content hash, and optional `workspace_id`. A null workspace is global; a non-null workspace refers to one workspace and cascades on workspace deletion.
- `kb_chunks` stores ordered, heading-aware passages for a document, including the contextual header, source text, chunker version, and content hash. The chunk hash must cover the text sent to the embedder, including its contextual prefix, so title or section changes invalidate the relevant embedding. Re-embed only when that hash or the chunker version changes.
- Use pgvector `halfvec(1024)` for Jina `jina-embeddings-v5-text-small` vectors. Passage and query requests use `retrieval.passage` and `retrieval.query` respectively. The HNSW index uses cosine distance (`halfvec_cosine_ops`).
- The generated `tsv` value is a language-neutral fallback representation of each header and passage. The plan is to use Neon-supported `pg_search` for BM25 when Liam confirms/enables it on the Neon branch; if that extension is unavailable on the target, use a GIN index on `tsv` instead. The migration is not applied until that prerequisite is confirmed.
- The BM25 index is keyed by the chunk UUID and covers the header and text. The document indexes support workspace, hub, publication-time, and source lookups. Chunk order is unique within each document.

## Search and ingestion plan (after approval)

1. Curate approved A/B-tier sources from Google Search Central, Bing Webmaster documentation, the GEO paper, community self-promotion rules, Vantage's growth-wiki pages, and vetted case studies. Monthly refreshes only propose sources; ingestion accepts approved sources only.
2. Chunk by heading at roughly 400–800 tokens with approximately 15% overlap. Prefix each chunk with title, section, date, and tier context before hashing and embedding. Batch Jina requests, retry transient failures, and record provider usage through the existing cost ledger (`JINA_API_KEY`); do not add a key or perform provider calls in this draft.
3. Retrieve up to 40 vector matches and 40 BM25 matches, apply Reciprocal Rank Fusion (RRF, a rank-position fusion with `k=60`), then rerank to at most eight results with `jina-reranker-v3`. Apply hub, since, and workspace filters; apply time decay only to the news hub.
4. Keep all reads tenant-scoped: global documents are visible as shared knowledge, while workspace documents are visible only to their owning workspace. This schema does not itself enforce query authorization; the future search implementation must prove that boundary in tests.
5. Add `search_insights({ query, hub?, since? })` only after approval. Answers cite chunk URLs or explicitly say there is no source.
6. Gate any change of embedding/search provider on a 50-question evaluation with expected URLs, reporting recall@8 and citation rate. The evaluation script and dataset are not part of this draft.

## Migration gate and verification

The migration declares pgvector and `pg_search` before creating their dependent column and indexes. Liam must enable/confirm those extensions on a Neon branch before the migration is run. This PR remains draft and is not merged or deployed; no production database, secrets, billing, auth, or `wrangler.jsonc` are touched. If `pg_search` is not available on that branch, use the `tsv` + GIN fallback before applying the migration. The database DDL has not been exercised against Neon in this draft.

The schema contract test protects table fields, nullable global scope, chunk ordering, vector dimensions, and index definitions. Local checks for this draft are lint, typecheck, and Vitest; no provider calls are made.
