# S43 — Pricing page and calculator

**Track:** Pricing (Idea 5) · **Wave:** 2 · **Size:** M · **Owner:** agent · **Depends on:** S03 (prices); S44 for the live `/ledger` link (soft) · **Unblocks:** S61

## Outcome
`/pricing` opens with a calculator (pick sources and scan frequency → provider cost + published margin) and a link to the live ledger (`/ledger`, built by S44, Wave 3; this slice renders the link only once the route exists, via a `LEDGER_PAGE_LIVE` constant defaulting to false that S44 flips, and shows plain text "Open ledger: coming soon" until then so no 404 link ships) plans are Free $0, Pro $5/$48, credits at cost + 15%.

## Scope
- Server component reading `provider_price` (fallback to constants) and plan data from `plan_limit` (S05) or constants until S05 merges.
- Client island `app/pricing/calculator.tsx`: sources (Reddit, HN/GitHub/etc., X scans/week, LinkedIn keywords, Facebook groups, Instagram keywords), frequency, shows the plan fee and the usage credits separately ("Pro $5/month + about $N in credits"; no paid-source selections means $0 in credits, the $5 plan fee still applies), with the review's worked example as a preset ("about $6.92 a month").
- Sections: plans, "What we don't cover", comparison table of competitors **only with sourced, dated prices** (record `checked_on`; remind to re-check before quoting publicly; Redreach pricing was unverified in the review, leave it out), FAQ, cancel-in-one-click statement, no-card free plan.
- SEO + JSON-LD (`Product` offers). 

## Acceptance criteria
- [ ] Calculator unit tests: the preset's inputs (sources, scans per week, frequency) are written out in the test fixture and priced from the `provider_price` seed, and reproduce $6.92 ± $0.05 for plan fee plus credits; the worked example's inputs are not in this repo, so if the owner cannot supply them from the review, pick explicit inputs, state them next to the preset, and label whatever total they produce instead of "$6.92". Zero paid-source selections = $0 in usage credits (plan fee shown separately). Credit rounding matches `quote()` (S41) when available.
  - **Decision (owner):** supply the review's worked-example inputs for the "$6.92" preset, or accept a recomputed preset. Recommendation: recompute from stated inputs and drop the $6.92 label if it cannot be reproduced.
- [ ] Every competitor price has a source link and checked-on date.
- [ ] Lighthouse SEO >= 95, accessibility >= 95.
