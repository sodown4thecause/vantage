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
