# S12 — Reddit keyword search and deep-search quota

**Track:** Reddit · **Wave:** 3 · **Size:** M · **Owner:** agent · **Depends on:** S10, S11 · **Unblocks:** S16 (copy), signup report

## Outcome
Workspaces can search all of Reddit by keyword for free, and Pro (and the signup report) can run quota-limited Agent "deep searches".

## Scope
- `lib/reddit/search.ts`: `searchReddit(query, ctx)` through TinyFish Search+Fetch (cost 0, still recorded), results into `shared_post` and matched to the workspace.
- `lib/reddit/deep.ts`: `deepSearchReddit(workspaceId, query)` using TinyFish Agent (about 12 steps at $0.016); reserves quota via `consume(workspaceId, "reddit_deep_search")` from S05 **before** the call; failed runs refund the quota and record zero cost.
- API `app/api/reddit/search/route.ts` (authorized) and a button on the Sources page "Run a deep search (n left this month)".
- Signup report: `lib/reports/signup.ts` composes one deep search + (later) an X scan under a daily dollar budget (S45 supplies the budget; until then a constant `SIGNUP_REPORT_DAILY_USD`).

## Acceptance criteria
- [ ] Quota exhausted returns a clear 402/429-style error code, never calls the provider.
- [ ] Concurrent deep searches cannot exceed quota (atomic consume test).
- [ ] Costs recorded; refund path tested.
- [ ] Free workspace: keyword search works, deep search not offered (limits from S05).

## Out of scope
Credits for extra deep searches (S42).
