# S44 — Open Ledger public page and rollups

**Track:** Pricing/Proof (Idea 5) · **Wave:** 3 · **Size:** M · **Owner:** agent · **Depends on:** S03 · **Unblocks:** S61

## Outcome
A public page showing real totals: provider cost per scan and per source, median cost per useful lead, margin, and source uptime.

## Scope
- `ledger_rollup` materialization (daily, from `cost_daily` + `opportunity_outcome` "useful" events + `shared_sweep_run` + source health): `lib/ledger/rollup.ts`, run from the cron tick.
- `app/ledger/page.tsx` (ISR-free, revalidate every 10 minutes using fetch cache headers or a cached table read) with charts built following the `dataviz` skill (accessible, light/dark). Sections: cost per source (30 days), cost per useful lead (median), revenue vs cost (from S40/S41 when available, else "not yet"), uptime per source (from S04/S11 data).
- **Rule:** nothing is shown until real data exists; empty state says "Collecting data since <date>". Estimates must be labelled; no made-up customers, counts or outcomes.
- Export: `GET /ledger.csv`.

## Acceptance criteria
- [ ] Rollup tests (idempotent, handles zero leads without dividing by zero).
- [ ] Page renders with empty, partial and full fixture data.
- [ ] No per-user identifiers in any output (privacy test).
