# S12 — Reddit keyword search and deep-search quota

**Track:** Reddit · **Wave:** 3 · **Size:** M · **Owner:** agent · **Depends on:** S10, S11 · **Unblocks:** S16 (copy), signup report

## Outcome
Workspaces can search all of Reddit by keyword for free, and Pro (and the signup report) can run quota-limited Agent "deep searches".

## Scope
- `lib/reddit/search.ts`: `searchReddit(query, ctx)` calls `getSourceSwitch("reddit")` first (paused returns a labelled `paused` state, no provider call), then TinyFish Search+Fetch (cost 0, still recorded), results into `shared_post` and matched to the workspace.
- `lib/reddit/deep.ts`: `deepSearchReddit(workspaceId, query, opts?)` checks the same `getSourceSwitch("reddit")` (paused returns a labelled state) and then uses TinyFish Agent (about 12 steps at $0.016); reserves quota via `consume(workspaceId, "deep_searches_per_month")` from S05 (the only deep-search metered key; `lib/plans/types.ts`) **before** the call; failed runs `release(workspaceId, "deep_searches_per_month")` the quota and record zero cost. The signup report calls it with `opts.signupReport = true`, which skips `consume`: Free plans have `deep_searches_per_month = 0` but get one Discovery Report (`discovery_reports`, a count limit that is not metered), so that deep search is bounded instead by the `SIGNUP_REPORT_DAILY_USD` budget (S45 defines only this shared daily dollar budget) and by a one-report-per-workspace rule that the signup report must itself enforce: check `discovery_reports` for an existing report for the workspace before allowing the `signupReport` option to skip `consume`. It is still recorded as a `cost_event`.
- API `app/api/reddit/search/route.ts` (authorized) and a button on the Sources page "Run a deep search (n left this month)".
- Signup report: `lib/reports/signup.ts` composes one deep search + (later) an X scan under a daily dollar budget (S45 supplies the budget; until then a constant `SIGNUP_REPORT_DAILY_USD`).

## Acceptance criteria
- [ ] Quota exhausted returns a clear 402/429-style error code, never calls the provider.
- [ ] Concurrent deep searches cannot exceed quota (atomic consume test).
- [ ] Costs recorded; refund path tested.
- [ ] Free workspace: keyword search works, deep search not offered (limits from S05), yet the signup report's deep search still runs once via `signupReport` without touching the quota.
- [ ] Reddit source paused: both `searchReddit` and `deepSearchReddit` return the paused state and make no provider call.

## Out of scope
Credits for extra deep searches (S42).
