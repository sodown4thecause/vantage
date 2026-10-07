# S45 — Free-plan guardrails, idle pause, renewal reminders

**Track:** Pricing (Idea 5) · **Wave:** 4 · **Size:** M · **Owner:** agent · **Depends on:** S05, S40, S41 · **Unblocks:** margin safety

## Outcome
The $5 plan stays profitable: the signup report is capped by a daily dollar budget, idle free projects pause, and paying users get a reminder before renewal.

## Scope
- Signup Discovery Report budget: `SIGNUP_REPORT_DAILY_USD` (default 5) enforced via the S06 `budget_day` mechanism with its own budget key, replacing a flat runs-per-day limit; over budget → "queued for tomorrow" state, not an error. S06's `budget_day` is currently keyed by `day` alone (`lib/db/schema.ts`, `lib/public/budget.ts`), so a second cap would share spend and overwrite `cap_usd` with the public-endpoint budget. This slice adds the dimension: column `budget_key text not null default 'public'` on `budget_day`, primary key replaced by `(day, budget_key)` (one migration; `budget_day` is a 14-day-pruned counter table, the one allowed exception to additive-only, and existing rows take the `'public'` key), and `reservePublicBudget`, `refundPublicSpend`, `settlePublicSpend`, `reconcilePublicSpend`, `pruneOldPublicRows` and the `BudgetReservation` type gain `budgetKey` (default `'public'`, so S06/S21 callers are unchanged), with every `INSERT ... ON CONFLICT` targeting `(day, budget_key)` and every update filtering on both. The signup report uses `budgetKey: 'signup_report'` and its cap from `SIGNUP_REPORT_DAILY_USD`. Tests: spending one key never changes the other's `spent_usd` or `cap_usd`; concurrent reservations still cannot exceed their own cap.
- Idle pause: cron job pauses (`source.health = 'paused'` via a new `paused_reason = 'idle'`) free workspaces with no sign-in in 14 days; one-click resume; email notice optional.
- Reminders: `lib/email/send.ts` provider-agnostic (Cloudflare Email Service or Resend, env `EMAIL_PROVIDER`, `EMAIL_API_KEY`), template for "Your Pro plan renews on <date>, manage or cancel here" 7 days before renewal (uses `billing_subscription.current_period_end` from S40); idempotent via `renewal_reminder_sent_at`.
- Monitor free-user cost: daily alert row when average free cost per user > $0.40 (writes to `ledger_alert`; surfaced in `/admin`).

## Acceptance criteria
- [ ] Tests: budget exhausted path, idle pause and resume, reminder sent once, not sent for cancelled subs.
- [ ] Admin view shows free-user average cost vs the $0.21 typical / $0.38 heavy model.

## Free basic scan: precise definition (7 Oct 2026, login-first)

The lead magnet is a **free basic scan inside a free, signed-in workspace**. It is the
single allowed cost-bearing action for a free account and is bounded on every axis.
The authoritative constants live in `lib/lead-magnet/definition.ts`; this section is
the human-readable copy of the same numbers.

| Dimension | Bound | Where enforced |
|---|---|---|
| Sources | FREE lane only: `hn`, `rss`, `substack` | `FREE_SCAN_SOURCE_TYPES`; production guard in `lib/collectors/run.ts` already blocks every other type/lane |
| Sources per scan | 8 | `FREE_SCAN_LIMITS.maxSourcesPerScan` in `runFreeScanSteps` |
| Documents scored | 50 most recent | `FREE_SCAN_LIMITS.maxDocuments` passed to `buildOpportunities` |
| Per user (workspace) / day | 1 scan, atomic | `claimFreeScan` upsert on `lead_magnet_scan(workspace_id, day)` |
| Global daily budget | `PUBLIC_DAILY_BUDGET_USD` (default 5), shared `budget_day` row | `reserveFreeScanBudget` — the S06 guard table |
| Cost estimate reserved per scan | $0.05 | `FREE_SCAN_ESTIMATE_USD` |

Paid sources (Grok X, Reddit deep, ScrapeCreators) are **not** part of the free basic
scan; they are credit-metered and opt-in. The free scan reuses the existing pipeline:
`runCollector` per source → `buildOpportunities` → `listOpportunityQueue`, wired through
`app/api/lead-magnet/run/route.ts` and the `runFreeFirstScan` server action. Stateful
endpoints stay behind `authorizeWorkspace`.

Outcomes are states, never errors: `per_user_limit` and `budget_exhausted` render as
"queued for tomorrow"; `no_sources` asks the user to save their profile first.

### Learned (free basic scan implementation)
- New table `lead_magnet_scan(workspace_id, day, scans, updated_at)` (migration generated
  with `pnpm db:generate`); the cap is a single guarded `INSERT ... ON CONFLICT` so
  concurrent submissions on neon-http cannot both pass.
- The S45 `budget_key` dimension on `budget_day` is **not** in this slice; the free scan
  deliberately shares the single S06 daily budget until that migration lands. Follow-up:
  give the free scan its own `budget_key` when S45's budget-dimension migration merges.
- Tests: `test/lead-magnet-scan.test.ts` (cap, budget exhaustion, release/refund,
  run orchestration) and `test/lead-magnet-route.test.ts` (auth + route contract).
