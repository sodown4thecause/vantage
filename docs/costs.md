# Cost ledger: what is metered and where

Every outbound paid or metered provider call writes one `cost_event` row via `withCost()` (`lib/costs/meter.ts`), which prices the call from `provider_price` (`getUnitCost`, `lib/costs/prices.ts`) and appends through `recordCost()` (`lib/costs/ledger.ts`). Failed calls are recorded with `ok = false` at zero cost unless `chargedOnFailure` is set. A ledger or price-table failure is logged and never changes the provider result or breaks a run; prices then come from the hard-coded `DEFAULT_PRICES`.

`cost_daily` (migration 0012) is the per-day rollup `(day, source_key, provider, action, calls, cost_usd, failed)`. `rollupDay(day)` (`lib/costs/rollup.ts`) rebuilds a UTC day from `cost_event` with a single `INSERT ... SELECT ... ON CONFLICT DO UPDATE` (totals overwritten, so reruns are idempotent). `app/api/cron/tick/route.ts` calls `rollupRecent()` (yesterday final, today partial) at the end of each tick, best effort.

## Metered call sites

| Provider | Action | Unit | Default USD/unit | Metered in | Used by |
|---|---|---|---|---|---|
| tinyfish | `agent_step` | step (`num_of_steps`, min 1) | 0.016 | `lib/tinyfish/agent.ts` `runTinyFishStructuredAgent` | youtube, producthunt agent fallbacks |
| tinyfish | `search` | request | 0 | `lib/tinyfish/search-fetch.ts` `tinyFishSearch` | youtube, producthunt |
| tinyfish | `fetch` | request (one per batch of 10 URLs) | 0 | `lib/tinyfish/search-fetch.ts` `tinyFishFetchMarkdown` | youtube, producthunt |
| scavio | `reddit_search` | request | 0.004 | `lib/reddit/client.ts` | reddit collector |
| scavio | `x_search` | request | 0.004 (assumed) | `lib/x/client.ts` | x collector |
| scavio | `youtube_comments` | request (one per video) | 0.004 (assumed) | `lib/youtube/client.ts` | youtube collector |

`source_key` is the collector type (`reddit`, `x`, `youtube`, `producthunt`) when a collector passes `ctx`, otherwise the client default (`tinyfish`, `reddit`, `x`, `youtube`). Provider functions keep their signatures and accept an optional `ctx?: { workspaceId?: string; sourceKey: string }`.

## Seeded for later slices (priced, not yet called)

| Provider | Action | Default USD/unit | Owner slice |
|---|---|---|---|
| grok | `x_search_post` | 0.005 per post, plus model call | S42 |
| grok | `score_post` | 0.0005 per post | S42 |
| scrapecreators | `request` | 0.0019 | S42 |
| browser_run | `browser_hour` | 0.09 per hour (use `X-Browser-Ms-Used`) | S07 |

Note: for Browser Run the `provider_price` key is `browser_run` / `browser_hour` (the helper looks up exactly that), while the `cost_event` rows it writes use `provider = cloudflare_browser_run`, `source_key = browser_run`; reprice by inserting a new `browser_run` / `browser_hour` row.

## Not metered (free quotas, $0)

HN, RSS, Substack, GitHub, Stack Overflow, YouTube Data API (`fetchViaYouTubeApi`, quota only), Product Hunt GraphQL API (`fetchViaProductHuntApi`, quota only). These make plain `fetch` calls with no per-call price.

## Seeding prices

`provider_price` is seeded by a human, per Neon branch: `DATABASE_URL=... pnpm tsx scripts/seed-prices.ts` (idempotent; skips existing provider/action rows). Each row's `notes` cites its source and date. Prices are from the 6 Oct 2026 competitor review; the Scavio X/YouTube prices are assumptions equal to Scavio Reddit. Re-check before quoting publicly. To change a price, insert a new row with a later `effective_from`; never update history.

## UNVERIFIED prices

The Scavio `x_search` and `youtube_comments` prices ($0.004) are an unverified assumption copied from Scavio Reddit; no source was found. Other seed notes carry "pricing page URL unverified" where the exact page is not known. Confirm before quoting publicly.

## Manual verification of the rollup (run on staging after applying 0012)

The rollup SQL is unit-tested only against a mock. The statement uses UTC day boundaries (`day::timestamp AT TIME ZONE 'UTC'`) and its `ON CONFLICT (day, source_key, provider, action)` matches the `cost_daily` primary key. To check it on a staging branch (human step, never production first):

```sql
-- 1. a throwaway event
INSERT INTO cost_event (source_key, provider, action, units, unit_cost_usd, cost_usd, ok)
VALUES ('verify', 'tinyfish', 'search', 1, 0, 0, true), ('verify', 'tinyfish', 'search', 1, 0, 0, false);
-- 2. run the rollup twice (via the cron tick, or paste the statement from lib/costs/rollup.ts with today's date)
-- 3. expect exactly one row: calls = 2, failed = 1, same after the second run
SELECT * FROM cost_daily WHERE source_key = 'verify';
-- 4. compare with the raw table
SELECT count(*), count(*) FILTER (WHERE NOT ok) FROM cost_event
WHERE source_key = 'verify' AND ts >= current_date::timestamp AT TIME ZONE 'UTC';
-- 5. clean up
DELETE FROM cost_daily WHERE source_key = 'verify';
DELETE FROM cost_event WHERE source_key = 'verify';
```

## Migration

`drizzle/0012_ambitious_rocket_raccoon.sql` adds `cost_daily` only. Applying it to Neon is a human step (`pnpm db:migrate`).
