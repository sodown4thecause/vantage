# S11 — Reddit provider chain and shared sweep

**Track:** Reddit (Idea 1) · **Wave:** 2 · **Size:** L · **Owner:** agent · **Depends on:** S02 (queue), S03 (cost), S04 (switch); informed by S10 · **Unblocks:** S12, S16, S21

## Outcome
Reddit works in the free plan at near-zero marginal cost: one shared sweep of about 100 AI/dev subreddits every 3 hours serves every workspace, and it degrades gracefully when Reddit blocks us.

## Decision (update after S10)
Default chain: **TinyFish Fetch → TinyFish Agent → Scavio Reddit (about $0.004) → last cached sweep → labelled "Reddit paused"**. Each step has its own provider switch (`reddit` gates the whole chain; `reddit:tinyfish_fetch`, `reddit:tinyfish_agent`, `reddit:scavio` gate individual steps, each checked with `getSourceSwitch(key)` and seeded in `source_switch`) and is skipped if its switch is off.
**Cost caps (numbers):** run-wide cap `SWEEP_RUN_BUDGET_USD = 0.25` (8 runs/day x 30 days x $0.25 = $60/month hard ceiling; the planned ~$23/month is about $0.10 per run) and paid-fallback cap `SWEEP_FALLBACK_BUDGET_USD = 0.10` per run covering TinyFish Agent plus Scavio combined. Before each paid call the job reads the run's running `cost_usd`; once either cap is reached, remaining communities skip paid steps and fall to the cached sweep (run becomes `partial`, label "budget_limited"). Per-job step caps: TinyFish Agent at most 1 step per community (about $0.016), Scavio at most 1 request. If more than 20% of communities in a run need Agent, treat Fetch as blocked: stop and alert rather than spend ($0.016 x 100 communities x 8 runs/day x 30 days is about $384/month, which is not the planned ~$23).

## Scope (vertical)
- **DB:** `reddit_community(name text primary key, tier int, active bool, last_swept_at, last_ok_at, fail_count int)`; seed ~100 subreddits from `data/reddit-communities.csv` (agent proposes the list: r/selfhosted, r/opensource, r/devops, r/LocalLLaMA, r/MachineLearning, r/webdev, r/node, r/golang, r/rust, r/programming, … human reviews). Reuse `shared_post`, `shared_sweep_run` (already migrated).
- **Lib:** `lib/reddit/chain.ts` (`fetchSubreddit(name, ctx)` returning `{posts, provider, costUsd}` walking the chain, each step wrapped in `withCost` and `getSourceSwitch("reddit")`), `lib/reddit/sweep.ts` (`planSweep()` → list of queue jobs, `runSweepJob(job)` → upsert `shared_post` by `(platform, external_id)` + `content_hash`, update community stats and bump the run's counters atomically, `communities_ok`/`communities_failed`/`cost_usd` incremented by the job in a single `UPDATE ... SET x = x + $n`; it does NOT close the run), `lib/reddit/match.ts` (`matchSharedPosts(workspaceId, since)` → `document` inserts for that workspace using its keywords from the monitoring profile; dedupe via existing `document_workspace_hash_uidx`).
- **Queue:** cron tick enqueues one job per community (batch 10) onto `vantage-sweep-jobs`; consumer route `app/api/internal/queue/route.ts` (bearer `CRON_SECRET`, from S02) dispatches `runSweepJob`. Sweep is **not** run inside `/api/cron/tick`. `planSweep()` inserts one `shared_sweep_run` (state `running`) and puts its `runId` plus the total job count in every job. Each `runSweepJob` finishes by atomically incrementing the counters and, in the same statement, setting `finished_at` and `state` (`ok`, or `partial` if any community failed or hit a cap) only when `communities_ok + communities_failed` reaches the run's total (store `communities_total` in the run via migration if absent, or in `metadata`); the last job to finish therefore closes the run exactly once. A finalizer in the tick closes runs stuck `running` for more than 30 minutes as `partial`. Queue redelivery must not double-count: dedupe on `(runId, community)`.
- **Collector change:** `lib/collectors/reddit.ts` stops calling providers per workspace; it calls `matchSharedPosts` and tags `metadata.provider = "shared_sweep:<provider>"`. Keep the fixture path for local dev only.
- **Guards:** relax the production "free pilot" guard in `lib/collectors/run.ts` for `reddit` only when the Reddit switch is on and the workspace is within plan limits; add `reddit` to the allow-list in `lib/cron/scan.ts`.
- **Coverage UI:** paused/degraded/stale label ("Reddit data is 7 h old; last sweep partial") in Settings → Sources; use `source_health` values `budget_limited`/`blocked`/`access_pending`.
- **Chaos test script:** `scripts/chaos/reddit-off.md` describing flipping the Reddit switch on staging and expected UI/tick behaviour.

## Acceptance criteria
- [ ] A workspace with a Reddit source gets documents from `shared_post` without any provider call made for that workspace (test: provider mock asserts zero calls).
- [ ] Sweep of N communities with injected provider failures: chain falls through in order, final fallback returns cached posts and marks the run `partial`; with switch off the UI shows paused and no provider is called.
- [ ] The run stays `running` until every community job has finished, then closes once with correct totals (test with out-of-order job completion and a redelivered job); caps stop paid fallbacks (test: Fetch always blocked, spend never exceeds `SWEEP_RUN_BUDGET_USD`); switching off `reddit:tinyfish_agent` alone skips only that step.
- [ ] Per-sweep cost is recorded and visible in `cost_event` (sum equals provider mocks).
- [ ] Re-running a sweep creates no duplicate `shared_post` rows.
- [ ] `worker-entry` tick still completes within the 120 s deadline (sweep decoupled).
- [ ] Documented cost per sweep from a staging run.

## Out of scope
Keyword search layer and deep search (S12), the public tracker (S16), X/LinkedIn (S42).

## Gotchas
Reddit Rule 8 and updated terms restrict scraping; keep the switch honest, 1 req/s per provider, identify no fake human behaviour. Never store full post bodies beyond what is needed (cap `body` to 4,000 chars).
