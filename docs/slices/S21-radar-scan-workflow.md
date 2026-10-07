# S21 — Radar scan workflow, API and cache

**Track:** Radar (Idea 2) · **Wave:** 3 · **Size:** L · **Owner:** agent · **Depends on:** S06, S07, S11, S13, S14, S20 · **Unblocks:** S22, S23, S50

## Outcome
Given a GitHub repo (or any public URL), Vantage returns the top 5 public threads with intent level, the sentence proving intent, and a reply-window clock, within about a minute, with no account.

## Scope
- **DB:** `radar_scan(id uuid, cache_key text, input_url, pack jsonb, state text, source_status jsonb, created_at, expires_at, visitor_hash, cost_usd, error_code)` with a unique index on `cache_key` for `done` scans (a new scan after expiry replaces or supersedes the old row; never two live rows per key). `source_status` is `{[sourceKey]: "ok" | "empty" | "timeout" | "error" | "paused"}`, written in step 6, so GET can tell a timed-out or paused source from a successful empty search; `radar_thread(id, scan_id, source, url, title, excerpt, intent_level int, evidence_sentence, posted_at, reply_window_ends)`.
- **Workflow:** `lib/radar/workflow.ts` exporting `RadarScan extends WorkflowEntrypoint` (Cloudflare Workflows; add class to the OpenNext worker entry via `worker-entry.mjs` re-export; binding `RADAR_SCAN` from S02). Steps (each `step.do` with retries and timeouts):
  1. normalize + cache lookup (24 h). `cache_key` is the canonical input: for a GitHub repo URL (any of `github.com/o/r`, `.git`, trailing slash, `www.`, path suffixes like `/tree/main`) it is `github:owner/repo` lower-cased; for any other URL it is `url:` + the lower-cased host and path with scheme, `www.`, query, fragment and trailing slash stripped. A hit returns the stored result;
  2. fetch repo material once (GitHub API / Browser Run) and return it from the step as JSON;
  3. `draftPackFromUrl` (S20) fed that material (S20 must accept an optional pre-fetched `material` argument so the page is never fetched twice, which would double Browser Run cost and latency);
  4. fan out (parallel, 8 s timeout each; call `getSourceSwitch(sourceKey)` first for every source, and a paused source is skipped and labelled `paused`, never silently dropped or called anyway): HN (Algolia), GitHub issues (S13), Stack Overflow/DEV.to/Lobsters/Bluesky (S14), plus **Reddit from `shared_post` only** (no live Reddit call), YouTube/Substack where configured;
  5. score with `lib/pipeline/intent-ladder.ts` + `lib/opportunities/features.ts`, keep top 5, extract the highlighted evidence sentence, compute reply window (`lib/pipeline/*` already has window logic);
  6. persist, record cost, mark `done`.
- **API:** `POST /api/radar` (order: validate + normalize input, then the read-only cache lookup, and on a hit return the cached `{scanId}` without reserving any budget; on a miss call S06 `guardPublicRequest`, so an exhausted daily cap never blocks a cached answer, then start the workflow and return `{scanId}`), `GET /api/radar/[id]` (state + results, public threads only), `GET /api/radar/by-repo/[owner]/[repo]`.
- **Safety:** only public threads; strip author handles beyond what the URL contains; label every source from `source_status` in the GET response ("HN: no result in time", "HN: paused by admin", versus an honest "HN: no matches" for `empty`); never include Reddit live search or X.

## Acceptance criteria
- [ ] End-to-end test with all sources mocked: produces <= 5 threads sorted by intent, cache hit on second call (zero provider calls).
- [ ] Failure test: three of six sources fail, result still returned with honest labels.
- [ ] Budget test: guard blocks when the daily cap is exhausted; cost recorded and reconciled.
- [ ] A staging scan of a real public repo completes < 90 s; cost per scan recorded in the PR.

## Out of scope
UI (S22), account handoff (S23), MCP (S50).

## Gotchas
Workflows steps must return JSON-serializable values and be idempotent. Keep the bundle size check (CI) in mind: lazy-import heavy modules.

## Follow-ups from the S06 and S07 reviews (6 Oct 2026)
- **Refund on failure:** `guardPublicRequest` (S06) returns a `reservation {day, estimateUsd}`. The scan code must call `refundPublicSpend(reservation)` when a scan fails (a cache hit reserves nothing, per the API order above; refund only if a reservation was made), and `settlePublicSpend`/`reconcilePublicSpend(requestRef, reservation)` with the real cost on success. Record every `cost_event` with `requestRef = scanId` so reconcile can sum it. Today `withCost` (`WithCostMeta` / `CostContext` in `lib/costs/meter.ts`) and the Browser Run helper (`BrowserRunOptions` in `lib/browser/run.ts`) do not forward `requestRef` to `recordCost` (the ledger input already supports it), so this slice must add an optional `requestRef` to `WithCostMeta`, `CostContext` and `BrowserRunOptions`, pass it through to `recordCost`, and thread `scanId` into every provider call in steps 2 to 4 (S13/S14 clients and `draftPackFromUrl` included). Add a test that a scan's `cost_event` rows all carry `requestRef = scanId` and that reconcile sums them (otherwise reconcile sees $0 and refunds the whole reservation).
- **Prune old rows:** `pruneOldPublicRows()` exists but nothing calls it; call it from the cron tick (14-day default).
- **Browser Run from a Workflow:** S07's helper must be given an explicit binding/env when called outside a request (Workflow steps and queue consumers have no OpenNext request context).
