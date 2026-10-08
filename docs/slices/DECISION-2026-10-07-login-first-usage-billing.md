# Decision, 7 Oct 2026: login-first, free basic scan, pure usage billing at cost + 20%

Owner decision (recorded from the product owner's instruction). It supersedes the earlier pricing and public-access decisions in `README.md` section 7 and the slices named below. Do not re-litigate inside a slice.

## What changes
1. **Everyone logs in.** No anonymous scans. The free **lead magnet is a basic scan inside a free account** (signed-in workspace, capped, cheap sources only). Anonymous visitors see a static sample result and a sign-up call to action.
2. **One paid mode: pay for what you use.** No monthly subscription fee. Customers top up credits; every metered action is charged at **actual provider cost x 1.20** (replaces 1.15). Prices are shown before each action and the Open Ledger (S44) publishes cost and margin.
3. **Provider set:** TinyFish (Reddit, web), Firecrawl (web/crawl, **new**), Scavio (fallback for X and social), Vercel AI Gateway for all model calls. **Update 8 Oct 2026:** the Grok plan is dropped; GPT 6.1 Sol (`openai/gpt-6.1-sol`) writes comment drafts and X collection uses Scavio only.

## Effect on slices
| Slice | Change |
|---|---|
| S05 | Free plan limits become the free basic scan caps; the Pro plan row is replaced by "credits" (paid actions need a positive balance, no plan flip). |
| S06 | Anonymous public guard (Turnstile, `public_visitor`) is no longer on the product path; keep the budget guard for any remaining unauthenticated route (sample result only). `ENABLE_PUBLIC_PING` stays unset. Turnstile secret is no longer a launch blocker. |
| S21, S22, S23 | Radar scan runs for signed-in users; anonymous flow becomes sample result then sign-up. S23 "restore scan after sign-up" simplifies to "start the free basic scan after first login". |
| S40 | Stripe subscription (`pro_monthly`, `pro_yearly`) dropped. Stripe is used for one-time credit top-ups only. Stripe prices are still not created until the currency is confirmed. |
| S41 | Becomes the core billing slice: markup constant 1.20, top-ups ($5/$10/$25) via Checkout payment mode. Compute credits in integer cents/micro-dollars (see rounding note). |
| S42 | Same 1.20 factor; add Firecrawl as a priced provider. |
| S43 | Calculator shows provider cost plus 20%, no plan fee. |
| S45 | Free-plan guardrails now cover the free basic scan (per-user and global daily budget). |

## Required follow-ups (not done yet)
- Add the Firecrawl price row to `provider_price` (`lib/costs/prices.ts`, `docs/costs.md`) from its current public pricing; no price is assumed here.
- ~~Verify the Grok model ID and update `grok` price rows.~~ Dropped 8 Oct 2026 with the Grok plan. Remove the `X_GATEWAY_*` experiment code and `grok` price rows in a follow-up.
- Rounding: `ceil(providerUsd * 1.20 * 100)` is unsafe in floating point (e.g. 0.15 * 1.2 * 100 can evaluate just above 18 and round up to 19). Do the markup in integer micro-dollars: `ceil(providerMicroUsd * 120 / 10_000 / 100)` style integer math, with a test on boundary values.
- Margin check: Stripe card fees on a $5 top-up are roughly 9% (2.9% + 30c), so 20% leaves about 11% after fees; keep the existing margin test and raise the minimum top-up if it fails.
- Define the free basic scan precisely (sources, post cap, one cheap model call, per-user/day cap) in S05/S45 before building.
- S50 anonymous MCP guard decision is resolved by login-first: MCP uses an account token.
