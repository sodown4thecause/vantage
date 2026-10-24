# Neon knowledge base: v2 design and migration gate

**Status:** Draft for review; this change is schema, provisional migration and contract tests only. Liam has authorised this design revision, not the final design or runtime implementation. The requested `pg_search` extension remains an unresolved prerequisite: the earlier isolated probe was rejected. Keep PR #112 draft until Liam approves the revised design and resolves that prerequisite. No fallback, new service or verified-support claim is authorised. The current generated migration number is provisional and excluded from merge: #98 owns 0032, #104 owns 0033, and #112 claims neither slot. Regenerate and renumber KB against then-current main only when Captain approves it.

## Revision plan and acceptance checklist

1. Preserve Reason's existing v2 schema and consolidate the previously split table/scope changes using Drizzle. The generated SQL and metadata remain together as a provisional, unapplied design artifact only. Do not edit generated SQL, snapshots or journal by hand, allocate a fake gap, or import launch schema. #98 owns 0032 and #104 owns 0033; KB numbering waits until Captain approves it against then-current main.
2. Remove the unused `tsv` representation; BM25 indexes the header and passage directly. Keep `pg_search` plus pgvector as explicit prerequisites, with no extension-enabling SQL in this draft migration.
3. Test the nullable-workspace scope constraint with positive and negative synthetic cases, including unauthorised cross-workspace access as a future retrieval contract, without building a KB query implementation.
4. Check generator stability, schema/migration contracts, workspace authorisation tests and Worker tests. Run the exact final-tree gates: `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm vitest run --pool=forks --maxWorkers=2`, plus the repository build. Record actual failures; no live provider, extension or evaluation runs.

## Scope and boundaries

Use one Neon database and the existing `public` schema only; do not add a third schema or database. Keep the KB separate from opportunity-scoring embeddings, which remain Workers AI Qwen3 plus Cloudflare Vectorize. KB reads will be tenant-scoped and read-only, return citations, or explicitly say no source was found. Vantage never posts, comments, votes, submits, or sends lists on anyone's behalf.

This draft does not implement ingestion, embedding calls, search queries, `search_insights`, an approval UI, refresh jobs, evaluation data, or a backfill. No provider calls or secrets are used.

## Data contract

- `kb_documents` stores source URL, optional title and publication time, capture time, curation tier (`A`–`D`), hub (`gtm`, `seo-geo`, `content`, `coding`, or `community-rules`), scope, approval state, nullable `workspace_id`, and content hash. A null `workspace_id` is allowed only for approved global material. Private rows require a non-null workspace; a database check constraint enforces both rules. Workspace deletion cascades to private material.
- `kb_chunks` stores ordered, heading-aware passages, contextual header, source text, chunker version, and content hash. Hash the full text sent to the embedder, including its contextual prefix; re-embed only when that hash or the chunker version changes.
- Use `jina-embeddings-v5-text-small` with `halfvec(1024)`, `retrieval.passage` and `retrieval.query`, and an HNSW cosine index (`halfvec_cosine_ops`).
- The requested keyword path is `pg_search` BM25, alongside pgvector; the BM25 index is keyed by chunk UUID and covers header and text directly. There is no `tsvector` fallback. Both extensions must be available and verified on an isolated Neon branch before the migration can be applied. Availability of `pg_search` is unresolved, not verified.
- Chunk order is unique within each document. Document indexes support workspace, hub, publication time, and source lookups. Keep all KB tables and indexes in `public`.

## Retrieval and ingestion plan (after approval)

1. Retrieve up to 40 keyword and 40 vector candidates, combine rankings with reciprocal rank fusion (RRF, `k=60`), and return the top eight. There is no compulsory reranker. Evaluate on 50 human-labelled questions: mean recall@8 must be at least 90%, valid citations 100%, and cross-workspace leakage zero. Trial `jina-reranker-v3` only if recall@8 fails, and record both the gain and latency.
2. Use Tako first and Linkup second, only to refresh approved sources. Linkup may create provenance-bearing proposed sources and quarantined research, but may not set approval flags or write trusted global chunks. Liam approves new monthly sources before ingestion. Store an empty URL list when citations cannot be resolved. Cache query plus parameters for 24 hours. Linkup standard search is $0.005; deep search is $0.05 and only behind `toolApproval`.
3. Chunk by heading at roughly 400–800 tokens with approximately 15% overlap. Prefix title, section, date, and tier before hashing and embedding. Batch Jina requests, retry transient failures, and record provider usage through the existing cost ledger. Do not add a key or make provider calls in this draft.
4. Apply hub, `since`, and workspace filters. Global approved documents may be shared; private documents are visible only to their owning workspace. The retrieval implementation must prove this boundary in tests.
5. Add `search_insights({ query, hub?, since? })` only after approval. Answers cite source URLs or explicitly state that no source was found.

## Isolated extension check and migration gate

Reason's earlier #103 comment reports that an extension check ran only on the isolated Neon branch `kb-extensions-probe-issue-103-pr-112`, created from `main`: pgvector 0.8.6 was verified, Neon rejected `pg_search` as “deprecated and no longer allowed”, and the probe compute was suspended. This revision does not repeat that probe or independently verify its results. No extension SQL or remote database operation is run in this revision. Do not apply the current BM25 migration to any branch until the requested extension prerequisite is resolved; v2 does not authorise a GIN fallback.

For a later authorised extension check:

1. Liam confirms a supported `pg_search` path and authorises an isolated test. Create a disposable Neon branch from the intended base; verify that its branch and endpoint IDs are not main, staging or production before connecting. Use the direct endpoint for migrations; never print credentials.
2. Enable pgvector and the requested `pg_search` only on that isolated branch, using the versions and syntax confirmed for that environment. Verify installed versions and BM25/halfvec capabilities there. Stop on rejection; never replace keyword search silently.
3. Only after those checks and Captain's regeneration/renumbering approval, apply the then-current generated KB migration on the disposable branch and test the constraints, indexes and workspace visibility. Record real evidence, suspend its compute and arrange cleanup. None of these steps is executed by this revision.
4. Liam separately approves the final design and any later target migration. Never use this test as approval to migrate main/staging/production.

PR #96 has merged and owns 0031. This revision consolidated the previously split KB table and scope changes from that main snapshot before Liam changed the allocation. The resulting `0032_kb_design_scope.sql` and matching generated metadata are now explicitly PROVISIONAL, unapplied and excluded from merge. They reserve no number: #98 owns 0032 and #104 owns 0033. Do not merge or apply this artifact as-is. This is not a rewrite of an applied migration. The generated migration intentionally does not enable extensions: the above prerequisites remain unresolved.

#98 must proceed independently and must not import this blocked KB draft. The shared Drizzle journal/snapshot history conflicts with the launch drafts, so #112 must rebase and regenerate/renumber against then-current main when Captain approves it. No allocation work or launch-schema borrowing is done now. Internal snapshot ordinals are generator metadata, not reservations: Drizzle alone assigns snapshot names, journal indices and `prevId`. The provisional artifact was generated with Drizzle Kit 0.31.10's default indexed generation and `--name=kb_design_scope`. A separate native naming check with `--prefix=none --name=0032_kb_design_scope` produced `_0032_kb_design_scope.sql` (including a leading underscore); it was not substituted. Never fabricate or manually renumber metadata to resolve the later dependency.

The schema contract tests cover nullability, the global/private constraint, chunk ordering, vector dimensions and index definitions. Scope tests use synthetic data only. They are design contracts, not proof of a live KB retrieval implementation: retrieval does not exist in this draft. No DDL has been applied or remote capability verified by this revision.

## Deferred implementation acceptance (not run)

The later reader must enforce `approved = true` and either global scope with a null workspace or private scope with exactly the authorised workspace ID, before both candidate retrieval paths and citation lookup. Never accept a workspace ID from a tool argument instead of the authorised context. Prove that a workspace can read its own approved private material and approved globals, cannot read another workspace's private material, and cannot read any unapproved material. No new query or mutation is introduced here.

This executable read-boundary contract uses `$1` for the authorised workspace. It describes the later reader, not a deployed query. Contract tests execute it and the schema's check predicate against synthetic rows in Node's in-memory SQLite; they do not verify PostgreSQL extensions, BM25, vectors or a runtime reader.

```sql
SELECT id FROM kb_documents
WHERE approved = true AND (
  (scope = 'global' AND workspace_id IS NULL)
  OR (scope = 'private' AND workspace_id = $1)
)
ORDER BY id
```

Ingest permissions, provenance-bearing proposed sources and quarantined research need an approval design before implementation; the default `approved = false` cannot create trusted global material. Linkup cannot set approval or write trusted global chunks. This schema draft does not claim that ingest permissions are implemented.

The 50 human-labelled questions and research datasets remain private in growth-wiki when authorised. No evaluation is run here, and recall, citation validity, latency and live zero-leakage results are unverified. Only synthetic fixtures belong in the public repository. Opportunity embeddings, Workers AI bindings, billing, auth, wrangler and observability remain unchanged.
