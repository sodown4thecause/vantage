# Follow-ups from the PR #34 review

Valid review findings that were deliberately not fixed in PR #34 (each needs a migration, a design change, or belongs to a later slice), plus owner decisions raised while fixing the specs. Nothing here blocks the merge.

## Deferred engineering work
| Area | Finding | Why it waited |
|---|---|---|
| Browser Run SSRF | `isPublicHttpUrl` checks the hostname only; it does not resolve DNS, so a public name pointing at a private address is not caught. | Workers have no resolver and Browser Run does the fetching; needs a DNS-aware egress allowlist (slice level). |
| Workspace creation (`lib/db/actions.ts`) | Check-then-insert race. | Needs a DB constraint (migration) or one atomic statement; neon-http has no transactions. |
| Source cap (`lib/sources/actions.ts`) | Same check-then-insert race on the per-plan source cap. | Same. |
| Collector fairness (`lib/collectors/run.ts`) | A paused type can starve enabled sources when a workspace has more than 8 sources (Pro allows 25). | Needs a rotation or filter design that also changes the "paused" messaging. |
| `cost_event.request_ref` index | Lookups by `request_ref` have no index. | Migration 0011 is applied in production and immutable; add the index in a new migration. |
| Public budget settlement | Settlement is not idempotent per reservation. | Needs a reservation id and storage (migration). |
| Public budget ledger | Does not fail closed when cost recording is incomplete. | Needs per-request tracking of `recordCost` success; a later cost-wiring slice. |
| Scheduled scans | Cadence is measured from source poll times. | A persisted scheduled-scan timestamp column (migration) would be cleaner. |
| Plan page | Project limit for owners with workspaces on different plans. | Needs a `getPlanUsage` API change; rare case. |
| Schema | Plain text columns (states, platforms) could be enums or check constraints. | New migration. |
| YouTube Data API fallback | Calls are not recorded in the cost ledger. | Free quota, no per-call price; needs an agreed zero-cost price row first. |
| `scripts/gtm/summarize.ts` | No 7 Nov cutoff for treating un-activated rescues as pending. | Doc updated to say so; script change is small but wasn't asked for. |
| Older casts | Many unsafe `as` casts outside this PR's files. | Separate cleanup. |

## New columns the specs now require
- `shared_sweep_run`: a total-communities counter (or `metadata`) so the last job closes the run (S11); additive migration.
- `credit_txn`: `hold_id`, plus a `credit_balance` guard table for atomic reservation (S41).
- `budget_day`: a `budget_key` column and a composite primary key `(day, budget_key)` (S45). This replaces a primary key, an exception to the additive-only migration rule; acceptable because the table is a short-lived counter.
- `monitor_pack`: `claim_token_hash`, `claim_expires_at` (S23).
- `radar_scan`: `cache_key`, `source_status`, `indexable` (S21, S22).

## Owner decisions
1. **S40 price currency:** USD (recommended) or AUD for the $5/month and $48/year prices. Do not create Stripe prices until confirmed.
2. **S51 local `vantage briefs`:** free locally (recommended), require a Pro login, or ship `scan` only. The spec says `scan` only until decided.
3. **S43 "$6.92" example:** supply the inputs, or drop the label and recompute from stated inputs (recommended).
4. **S50 anonymous MCP scans:** a Turnstile pass token (recommended), a free-account API token (conflicts with S05 reserving API/MCP for Pro), or cached results only.
5. **S45 primary-key change** on `budget_day`: confirm the exception to additive-only migrations.
6. **S12 signup report:** it skips the deep-search quota and is capped only by the one-report rule and the daily budget; confirm.
