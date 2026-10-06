# S43 — Pricing page and calculator

**Track:** Pricing (Idea 5) · **Wave:** 2 · **Size:** M · **Owner:** agent · **Depends on:** S03 (prices) · **Unblocks:** S61

## Outcome
`/pricing` opens with a calculator (pick sources and scan frequency → provider cost + published margin) and a link to the live ledger; plans are Free $0, Pro $5/$48, credits at cost + 15%.

## Scope
- Server component reading `provider_price` (fallback to constants) and plan data from `plan_limit` (S05) or constants until S05 merges.
- Client island `app/pricing/calculator.tsx`: sources (Reddit, HN/GitHub/etc., X scans/week, LinkedIn keywords, Facebook groups, Instagram keywords), frequency, shows `$5 + N credits ≈ $X/month`, with the review's worked example as a preset ("about $6.92 a month").
- Sections: plans, "What we don't cover", comparison table of competitors **only with sourced, dated prices** (record `checked_on`; remind to re-check before quoting publicly; Redreach pricing was unverified in the review, leave it out), FAQ, cancel-in-one-click statement, no-card free plan.
- SEO + JSON-LD (`Product` offers). 

## Acceptance criteria
- [ ] Calculator unit tests: preset reproduces $6.92 ± $0.05; zero selections = $0; credit rounding matches `quote()` (S41) when available.
- [ ] Every competitor price has a source link and checked-on date.
- [ ] Lighthouse SEO >= 95, accessibility >= 95.
