# S11 — Reddit provider chain and shared sweep

**Track:** Reddit (Idea 1) · **Wave:** 2 · **Size:** L · **Owner:** agent · **Depends on:** S02 (queue), S03 (cost), S04 (switch); informed by S10 · **Unblocks:** S12, S16, S21

## Outcome
Reddit works in the free plan at near-zero marginal cost: one shared sweep of about 100 AI/dev subreddits every 3 hours serves every workspace, and it degrades gracefully when Reddit blocks us.

## Decision (update after S10)
Default chain: **TinyFish Fetch → TinyFish Agent → Scavio Reddit (about $0.004) → last cached sweep → labelled "Reddit paused"**. Each step has its own cost cap and is skipped if its provider switch is off.

## Scope (vertical)
- **DB:** `reddit_community(name text primary key, tier int, active bool, last_swept_at, last_ok_at, fail_count int)`; seed ~100 subreddits from `data/reddit-communities.csv` (agent proposes the list: r/selfhosted, r/opensource, r/devops, r/LocalLLaMA, r/MachineLearning, r/webdev, r/node, r/golang, r/rust, r/programming, … human reviews). Reuse `shared_post`, `shared_sweep_run` (already migrated).
- **Lib:** `lib/reddit/chain.ts` (`fetchSubreddit(name, ctx)` returning `{posts, provider, costUsd}` walking the chain, each step wrapped in `withCost` and `getSourceSwitch("reddit")`), `lib/reddit/sweep.ts` (`planSweep()` → list of queue jobs, `runSweepJob(job)` → upsert `shared_post` by `(platform, external_id)` + `content_hash`, update community stats, close `shared_sweep_run`), `lib/reddit/match.ts` (`matchSharedPosts(workspaceId, since)` → `document` inserts for that workspace using its keywords from the monitoring profile; dedupe via existing `document_workspace_hash_uidx`).
- **Queue:** cron tick enqueues one job per community (batch 10) onto `vantage-sweep-jobs`; consumer route `app/api/internal/queue/route.ts` (bearer `CRON_SECRET`, from S02) dispatches `runSweepJob`. Sweep is **not** run inside `/api/cron/tick`.
- **Collector change:** `lib/collectors/reddit.ts` stops calling providers per workspace; it calls `matchSharedPosts` and tags `metadata.provider = "shared_sweep:<provider>"`. Keep the fixture path for local dev only.
- **Guards:** relax the production "free pilot" guard in `lib/collectors/run.ts` for `reddit` only when the Reddit switch is on and the workspace is within plan limits; add `reddit` to the allow-list in `lib/cron/scan.ts`.
- **Coverage UI:** paused/degraded/stale label ("Reddit data is 7 h old; last sweep partial") in Settings → Sources; use `source_health` values `budget_limited`/`blocked`/`access_pending`.
- **Chaos test script:** `scripts/chaos/reddit-off.md` describing flipping the Reddit switch on staging and expected UI/tick behaviour.

## Acceptance criteria
- [ ] A workspace with a Reddit source gets documents from `shared_post` without any provider call made for that workspace (test: provider mock asserts zero calls).
- [ ] Sweep of N communities with injected provider failures: chain falls through in order, final fallback returns cached posts and marks the run `partial`; with switch off the UI shows paused and no provider is called.
- [ ] Per-sweep cost is recorded and visible in `cost_event` (sum equals provider mocks).
- [ ] Re-running a sweep creates no duplicate `shared_post` rows.
- [ ] `worker-entry` tick still completes within the 120 s deadline (sweep decoupled).
- [ ] Documented cost per sweep from a staging run.

## Out of scope
Keyword search layer and deep search (S12), the public tracker (S16), X/LinkedIn (S42).

## Gotchas
Reddit Rule 8 and updated terms restrict scraping; keep the switch honest, 1 req/s per provider, identify no fake human behaviour. Never store full post bodies beyond what is needed (cap `body` to 4,000 chars).
