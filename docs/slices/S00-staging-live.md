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
- [x] Manual tick returns 200 with `ok:true` (6 Oct 16:19 UTC).
- [x] A signed-up staging workspace has at least one `document` and one `opportunity` row from an HN source (6 Oct 16:20 UTC: 1 document, 1 opportunity, source healthy).
- [~] Scheduled cron: the first run fired on schedule at 18:01 UTC (source polled; wiring works) but the HN collector hit its 4 s timeout, so that run counts as a failure (`The operation was aborted due to timeout`, recorded in `source.config.lastRun`). Two manual ticks at 18:20 were healthy. **Still needed:** a fully clean scheduled run (next at 21:00 UTC, then 00:00 UTC). If timeouts repeat, raise the 4 s limit in `lib/collectors/hn.ts`.
- [ ] `docs/slices/README.md` status table updated; "Learned" notes added below.
- [ ] No secret value appears in any commit, PR, or log excerpt.

## Out of scope
Production, custom domain, new features, Reddit/X/paid sources.

## Gotchas
`/` returns 200 without a database (signed-out page), so use `/api/cron/tick` or a signed-in page to test the DB. `wrangler tail` needs the Worker name without `--env` (`vantage-staging`). A new Neon Auth trusted origin is required for every new hostname.

## Learned
- Done 6 Oct: `DATABASE_URL` set; tick 200; Playwright (headless Chromium, `ignoreHTTPSErrors` because of the sandbox proxy CA) drove sign-up → create workspace → onboarding → profile v1 → auto-provisioned "Profile: Hacker News" source. Scan via `GET /api/cron/tick?workspaceId=<id>` inserted 1 HN document and 1 opportunity.
- Staging cron `0 */3 * * *` is registered (Cloudflare schedules API confirms). **Still to verify:** first scheduled run at 18:00 UTC (look for `[cron] tick completed` in `wrangler tail vantage-staging`), then a second at 21:00 UTC.
- **Auth pages 404 bug (fixed 6 Oct):** `/auth/sign-up` and `/auth/sign-in` returned 404 on the Worker because `app/auth/[path]/page.tsx` was prerendered (`generateStaticParams` + `dynamicParams=false`) and the Worker has no incremental cache. Now `force-dynamic` with `notFound()` for unknown paths. API-only smoke tests missed it: always test the pages a visitor clicks to. Verified with a browser form sign-up on staging.
- Saving a profile auto-provisions the HN source (`provisionProfileSources` in `lib/profile/repository.ts`), so a separate "add source" step is not needed.
- The Sources page scan button was not found by a text match on "scan"; check the label in `app/source-controls.tsx` before writing UI tests.
- The smoke workspace `f65e5abb-c0c0-4bb3-afac-acf9cc7bd208` and two smoke users exist on staging only; delete after the cron checks (needs owner OK).
