# S21 — Radar scan workflow, API and cache

**Track:** Radar (Idea 2) · **Wave:** 3 · **Size:** L · **Owner:** agent · **Depends on:** S06, S07, S11, S13, S14, S20 · **Unblocks:** S22, S23, S50

## Outcome
Given a GitHub repo (or any public URL), Vantage returns the top 5 public threads with intent level, the sentence proving intent, and a reply-window clock, within about a minute, with no account.

## Scope
- **DB:** `radar_scan(id uuid, repo_key text unique, input_url, pack jsonb, state text, created_at, expires_at, visitor_hash, cost_usd, error_code)`; `radar_thread(id, scan_id, source, url, title, excerpt, intent_level int, evidence_sentence, posted_at, reply_window_ends)`.
- **Workflow:** `lib/radar/workflow.ts` exporting `RadarScan extends WorkflowEntrypoint` (Cloudflare Workflows; add class to the OpenNext worker entry via `worker-entry.mjs` re-export; binding `RADAR_SCAN` from S02). Steps (each `step.do` with retries and timeouts):
  1. normalize + cache lookup (24 h, key `owner/repo`; hit returns stored result);
  2. fetch repo material (GitHub API / Browser Run);
  3. `draftPackFromUrl` (S20);
  4. fan out (parallel, 8 s timeout each): HN (Algolia), GitHub issues (S13), Stack Overflow/DEV.to/Lobsters/Bluesky (S14), plus **Reddit from `shared_post` only** (no live Reddit call), YouTube/Substack where configured;
  5. score with `lib/pipeline/intent-ladder.ts` + `lib/opportunities/features.ts`, keep top 5, extract the highlighted evidence sentence, compute reply window (`lib/pipeline/*` already has window logic);
  6. persist, record cost, mark `done`.
- **API:** `POST /api/radar` (guarded by S06 `guardPublicRequest`, returns `{scanId}`), `GET /api/radar/[id]` (state + results, public threads only), `GET /api/radar/by-repo/[owner]/[repo]`.
- **Safety:** only public threads; strip author handles beyond what the URL contains; label sources that timed out ("HN: no result in time"); never include Reddit live search or X.

## Acceptance criteria
- [ ] End-to-end test with all sources mocked: produces <= 5 threads sorted by intent, cache hit on second call (zero provider calls).
- [ ] Failure test: three of six sources fail, result still returned with honest labels.
- [ ] Budget test: guard blocks when the daily cap is exhausted; cost recorded and reconciled.
- [ ] A staging scan of a real public repo completes < 90 s; cost per scan recorded in the PR.

## Out of scope
UI (S22), account handoff (S23), MCP (S50).

## Gotchas
Workflows steps must return JSON-serializable values and be idempotent. Keep the bundle size check (CI) in mind: lazy-import heavy modules.
