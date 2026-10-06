# S03 — Wire the cost ledger into every provider, plus rollups

**Track:** Foundations · **Wave:** 1 · **Size:** M · **Owner:** agent · **Depends on:** none · **Unblocks:** S11, S13, S14, S41, S43, S44

## Outcome
Every outbound paid or metered call writes a `cost_event`, prices come from `provider_price`, and a daily rollup answers "what did each source cost".

## Scope (vertical)
- **DB:** migration adding `cost_daily` rollup table `(day date, source_key, provider, action, calls int, cost_usd numeric(12,6), failed int, primary key(day, source_key, provider, action))`; seed `provider_price` rows (migration data step or `scripts/seed-prices.ts` run manually) for: tinyfish agent step 0.016, tinyfish search/fetch 0, scavio reddit ~0.004, grok x_search per post 0.005 + model call, grok-4.3 scoring ~0.0005/post, scrapecreators 0.0019, browser-run 0.09/hour. Values from README section 4; mark `notes` with source URLs/dates.
- **Lib:** `lib/costs/prices.ts` (`getUnitCost(provider, action, at?)` reading `provider_price` with a 60s in-memory cache and a hard-coded fallback so a missing table never breaks a run); `lib/costs/rollup.ts` (`rollupDay(day)`, upsert from `cost_event`); `lib/costs/meter.ts` helper `withCost(opts, fn)` that records success/failure around a provider call.
- **Wire in:** `lib/tinyfish/agent.ts`, `lib/tinyfish/search-fetch.ts`, `lib/scavio/client.ts` users (`lib/reddit/client.ts`, `lib/x/client.ts`, `lib/youtube/client.ts`), `lib/producthunt/client.ts`. Keep each provider's public function signature unchanged; add an optional `ctx?: {workspaceId?: string; sourceKey: string}` parameter.
- **API/cron:** call `rollupDay(yesterday)` and today's partial at the end of `app/api/cron/tick/route.ts` (best effort, logged, never fails the tick).
- **Docs:** `docs/costs.md` listing every provider/action and where it is metered.

## Interfaces
```ts
withCost<T>(meta: {sourceKey: string; provider: string; action: string; workspaceId?: string|null;
  units?: (r: T) => number; billableTo?: "platform"|"workspace_credits"; chargedOnFailure?: boolean},
  fn: () => Promise<T>): Promise<T>
```

## Acceptance criteria
- [x] Unit tests: price lookup with and without DB row, cache expiry, `withCost` records success, failure (zero cost unless `chargedOnFailure`), and never swallows the provider error.
- [x] Each wired client has a test proving one `cost_event` per call using a mocked fetch and mocked `recordCost`.
- [x] Rollup test: idempotent (running twice gives the same totals).
- [x] No behaviour change when `provider_price` or `cost_event` are missing (logged, run continues).
- [x] `docs/costs.md` complete.

## Out of scope
Credits/billing (S41), public ledger page (S44), paid sources behind credits (S42).

## Gotchas
neon-http has no interactive transactions; rollup uses one `INSERT ... ON CONFLICT DO UPDATE ... SELECT` statement. Do not log request bodies.

## Learned
- Status: [x] implemented on `slice/S03-cost-ledger-wiring` (draft PR); migration `0012_ambitious_rocket_raccoon.sql` (`cost_daily`) not yet applied to any Neon branch (human step), and `scripts/seed-prices.ts` not yet run (`DEFAULT_PRICES` is the fallback until then).
- Metering lives in the lowest layer (TinyFish agent/search/fetch wrappers and the Scavio call sites), so every path (collectors, fallbacks) is covered by one wrapper per call. `docs/costs.md` is the map.
- Free-quota APIs (YouTube Data, Product Hunt GraphQL) are deliberately not metered. Scavio X and YouTube prices are assumed equal to Scavio Reddit ($0.004) until confirmed.
- The tick rollup is best effort: `rollupRecent` swallows errors (the existing `cron-tick` mock has no `execute`).
- Grok/ScrapeCreators/Browser Run prices are seeded only; their callers arrive in S42/S07.
