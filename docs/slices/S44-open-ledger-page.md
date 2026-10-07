# S44 — Open Ledger public page and rollups

**Track:** Pricing/Proof (Idea 5) · **Wave:** 3 · **Size:** M · **Owner:** agent · **Depends on:** S03 · **Unblocks:** S61

## Outcome
A public page showing real totals: provider cost per scan and per source, average cost per useful lead, margin, and per-source call success rate.

## Scope
- `ledger_rollup` materialization (daily, from `cost_daily` + `opportunity_outcome` "useful" events + `shared_sweep_run`): `lib/ledger/rollup.ts`, run from the cron tick. Metric definitions (state them on the page):
  - **Cost per useful lead** is an aggregate ratio, not a per-lead median: total platform `cost_usd` from `cost_daily` over the window divided by the count of `opportunity_outcome` rows with a "useful" event in the same window (distinct opportunities). `cost_daily` has no per-lead cost and `opportunity_outcome` carries no cost, so no median is computed. Show a per-source ratio only for sources where the outcome can be joined to the source (opportunity to document to source); otherwise show the overall ratio only. Zero useful leads shows "not enough data", never a division by zero.
  - **Call success rate per source** (not "uptime"): `1 - failed/calls` from `cost_daily` per `source_key` over 30 days. S04 stores only current health and S11 records runs only for shared sweeps, so historical uptime is not available; do not label this uptime. Show the current paused/active state from `source_switch` beside it, and for Reddit add the `shared_sweep_run` ok/partial ratio.
- `app/ledger/page.tsx` (`export const dynamic = "force-dynamic"`; no ISR or incremental cache, which the Worker does not have. Freshness comes from the cron-refreshed `ledger_rollup` table, so each request is one small indexed read; `/ledger.csv` may add `Cache-Control: public, s-maxage=600` response headers) with charts built following the `dataviz` skill (accessible, light/dark). Sections: cost per source (30 days), cost per useful lead (aggregate ratio, see definitions), revenue vs cost (from S40/S41 when available, else "not yet"), call success rate per source (from `cost_daily`, plus S04 switch state and S11 sweep runs).
- **Rule:** nothing is shown until real data exists; empty state says "Collecting data since <date>". Estimates must be labelled; no made-up customers, counts or outcomes.
- Export: `GET /ledger.csv`.

## Acceptance criteria
- [ ] Rollup tests (idempotent, handles zero leads without dividing by zero).
- [ ] Page renders with empty, partial and full fixture data.
- [ ] No per-user identifiers in any output (privacy test).
