# S00 — Staging live end to end

**Track:** Platform · **Wave:** 0 · **Size:** S · **Owner:** human (H1) + agent · **Depends on:** none · **Unblocks:** everything

## Outcome
A visitor can sign up on `https://vantage-staging.liam-wilson1990.workers.dev`, onboard, add an HN source, and see real documents and a ranked opportunity produced by the 3-hour cron, with no secret in the build.

## Current state
Worker `vantage-staging` is deployed. Secrets set: `CRON_SECRET`, `NEON_AUTH_COOKIE_SECRET`, `NEON_AUTH_BASE_URL`. `/api/cron/tick` returns 500 with `DATABASE_URL is not set`. Neon Auth sign-up already works against the `staging` branch. Migration 0011 is applied on `staging`.

## Steps
1. **H1 (human):** set `DATABASE_URL` (pooled string of Neon branch `staging`) on `vantage-staging`: `wrangler secret put DATABASE_URL --env staging` or dashboard → Workers → vantage-staging → Settings → Variables and Secrets.
2. Agent: rotate `CRON_SECRET` into a shell variable (never print it) and call `GET /api/cron/tick` with `Authorization: Bearer`. Expect 200 and `{ok:true}`.
3. Agent: sign up a test user via `POST /api/auth/sign-up/email` (header `origin: <staging url>`), keep the cookie jar, complete onboarding (`/onboarding`, `app/api/profile/route.ts`), add an HN source (`app/api/sources/route.ts` or the Settings → Sources page), run `scanNow`, then query Neon (`mcp__Neon__run_sql`, branch `br-quiet-pine-b7ukjr3b`) to confirm `document` and `opportunity` rows.
4. Enable the staging cron only: in `wrangler.jsonc` set `env.staging.triggers.crons` to `["0 */3 * * *"]` (leave the top level and `env.production` as `[]`). Deploy staging. Watch `wrangler tail vantage-staging` for one scheduled run (`[cron] tick completed`).
5. Delete the smoke-test user and its workspace (ask the owner first; destructive).

## Acceptance criteria
- [ ] Manual tick returns 200 with `ok:true`.
- [ ] A signed-up staging workspace has at least one `document` and one `opportunity` row from an HN source.
- [ ] One scheduled cron run succeeded (log line seen), and a second one 3 hours later (check the next day).
- [ ] `docs/slices/README.md` status table updated; "Learned" notes added below.
- [ ] No secret value appears in any commit, PR, or log excerpt.

## Out of scope
Production, custom domain, new features, Reddit/X/paid sources.

## Gotchas
`/` returns 200 without a database (signed-out page), so use `/api/cron/tick` or a signed-in page to test the DB. `wrangler tail` needs the Worker name without `--env` (`vantage-staging`). A new Neon Auth trusted origin is required for every new hostname.

## Learned
(fill in)
