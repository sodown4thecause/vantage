# S06 — Public endpoint guard (rate limit, Turnstile, daily dollar budget)

> **Amended 7 Oct 2026** by `DECISION-2026-10-07-login-first-usage-billing.md`: Anonymous scans are no longer on the product path; login-first.

**Track:** Foundations · **Wave:** 1 · **Size:** M · **Owner:** agent + human (H8) · **Depends on:** S02 (rate-limit binding; can stub with a Neon-backed limiter first) · **Unblocks:** S21

## Outcome
Any unauthenticated, cost-bearing endpoint (first user: Radar scan) is protected against abuse and cannot spend more than a daily dollar cap.

## Scope
- **DB:** `budget_day(day date primary key, spent_usd numeric(12,6), cap_usd numeric(12,6))`, `public_visitor(visitor_hash text, day date, scans int, primary key(visitor_hash, day))` (migration).
- **Lib:** `lib/public/guard.ts`: `guardPublicRequest(req, {action, costEstimateUsd, perVisitorPerDay})` returning `{ok:true, visitorHash, reservation: {day, estimateUsd}}` or `{ok:false, status, code}`. Checks in order: Turnstile token (header `x-turnstile-token`, verify against `https://challenges.cloudflare.com/turnstile/v0/siteverify`; fails closed when `TURNSTILE_SECRET_KEY` is unset; bypassed only outside production when `TURNSTILE_DEV_BYPASS=true`), `RADAR_LIMITER` binding (when present), per-visitor daily count, global budget (atomic `UPDATE budget_day SET spent_usd = spent_usd + $est WHERE spent_usd + $est <= cap_usd`).
- `visitorHash` = SHA-256 of IP + daily salt (env `VISITOR_SALT`), never store raw IP.
- `lib/public/budget.ts` `recordPublicSpend(actualUsd)` reconciles estimate vs actual from `cost_event`.
- Env: `PUBLIC_DAILY_BUDGET_USD` (default 5), `TURNSTILE_SECRET_KEY`, `VISITOR_SALT`.
- Test route `app/api/public/ping/route.ts` guarded, used only to prove the guard in tests/staging.

## Acceptance criteria
- [x] Tests: missing/invalid Turnstile, rate limit hit, visitor daily cap, budget exhausted (returns 429/503 with stable error codes), concurrent budget spend never exceeds the cap.
- [x] Error bodies leak nothing (see `test/error-disclosure-contract.test.ts`).
- [x] Documented env vars in `.env.example`.

## Out of scope
The Radar scan itself (S21), CAPTCHA UI widget (S22 includes it).

## Gotchas
Human H8: create a Turnstile widget in the Cloudflare dashboard; staging can use Cloudflare's published always-pass test keys.

## Learned (implementation notes)
- Migration `0014_rapid_scourge.sql` (additive: `budget_day`, `public_visitor`; `0012_ambitious_rocket_raccoon.sql` is S03's `cost_daily`). Not applied to any database.
- The `RADAR_LIMITER` binding is optional: read via `getCloudflareContext().env` and skipped when absent; the Neon per-visitor and budget checks work without it. `wrangler.jsonc` untouched (S02 owns the binding).
- Turnstile: with `TURNSTILE_SECRET_KEY` unset the guard fails closed (`503 guard_unavailable`) unless it is not production **and** `TURNSTILE_DEV_BYPASS=true`, in which case the check is skipped. Staging is a production build, so staging needs either Cloudflare's always-pass test keys as `TURNSTILE_SECRET_KEY` (the Gotchas route) or no bypass at all. A missing `VISITOR_SALT` in production also fails closed.
- Both counters are single atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE` statements (neon-http has no interactive transactions). The visitor count is incremented before the budget is reserved, so a budget rejection still consumes one visitor scan (conservative).
- Stable error codes: `turnstile_required`/`turnstile_failed` (403), `rate_limited`/`visitor_limit` (429), `budget_exhausted`/`guard_unavailable` (503).
- `reconcilePublicSpend(requestRef, estimate)` sums `cost_event` by `request_ref`; S21 must record costs with that `requestRef`.
- Tests emulate the two upserts in memory (the mock cannot prove Postgres atomicity; it asserts the SQL is a single guarded statement). Verify on staging Neon once H1 lands.
- Open gates: H8 Turnstile keys; S02 rate-limit binding (`RADAR_LIMITER`); apply migration 0014.
- Review follow-ups: `guardPublicRequest` returns `reservation: {day, estimateUsd}`; use `settlePublicSpend`/`refundPublicSpend`/`reconcilePublicSpend` with it (pinned to the reserved day, so midnight is safe). Call `refundPublicSpend` when a scan fails. Turnstile bypass now needs `TURNSTILE_DEV_BYPASS=true` and is ignored in production; siteverify has a 5s timeout; production trusts only `cf-connecting-ip` (else 400 `client_unidentified`); the ping route 404s unless `ENABLE_PUBLIC_PING=true` (set on staging and in tests only; `NODE_ENV` cannot gate it because staging is also a production build). `pruneOldPublicRows()` exists but is not scheduled yet.
