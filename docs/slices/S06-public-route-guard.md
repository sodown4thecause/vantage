# S06 — Public endpoint guard (rate limit, Turnstile, daily dollar budget)

**Track:** Foundations · **Wave:** 1 · **Size:** M · **Owner:** agent + human (H8) · **Depends on:** S02 (rate-limit binding; can stub with a Neon-backed limiter first) · **Unblocks:** S21

## Outcome
Any unauthenticated, cost-bearing endpoint (first user: Radar scan) is protected against abuse and cannot spend more than a daily dollar cap.

## Scope
- **DB:** `budget_day(day date primary key, spent_usd numeric(12,6), cap_usd numeric(12,6))`, `public_visitor(visitor_hash text, day date, scans int, primary key(visitor_hash, day))` (migration).
- **Lib:** `lib/public/guard.ts`: `guardPublicRequest(req, {action, costEstimateUsd, perVisitorPerDay})` returning `{ok:true, visitorHash}` or `{ok:false, status, code}`. Checks in order: Turnstile token (header `x-turnstile-token`, verify against `https://challenges.cloudflare.com/turnstile/v0/siteverify`; skip in non-production if `TURNSTILE_SECRET_KEY` unset), `RADAR_LIMITER` binding (when present), per-visitor daily count, global budget (atomic `UPDATE budget_day SET spent_usd = spent_usd + $est WHERE spent_usd + $est <= cap_usd`).
- `visitorHash` = SHA-256 of IP + daily salt (env `VISITOR_SALT`), never store raw IP.
- `lib/public/budget.ts` `recordPublicSpend(actualUsd)` reconciles estimate vs actual from `cost_event`.
- Env: `PUBLIC_DAILY_BUDGET_USD` (default 5), `TURNSTILE_SECRET_KEY`, `VISITOR_SALT`.
- Test route `app/api/public/ping/route.ts` guarded, used only to prove the guard in tests/staging.

## Acceptance criteria
- [ ] Tests: missing/invalid Turnstile, rate limit hit, visitor daily cap, budget exhausted (returns 429/503 with stable error codes), concurrent budget spend never exceeds the cap.
- [ ] Error bodies leak nothing (see `test/error-disclosure-contract.test.ts`).
- [ ] Documented env vars in `.env.example`.

## Out of scope
The Radar scan itself (S21), CAPTCHA UI widget (S22 includes it).

## Gotchas
Human H8: create a Turnstile widget in the Cloudflare dashboard; staging can use Cloudflare's published always-pass test keys.
