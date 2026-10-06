# S01 — Production promotion, rollback, CI deploy

**Track:** Platform · **Wave:** 0 · **Size:** M · **Owner:** agent + human (H2) · **Depends on:** S00 · **Unblocks:** any production release

## Outcome
Production Worker `dontkillmyvibe` runs the same bundle as staging against Neon `main`, with a rehearsed rollback and an automated staging deploy on merge.

## Scope
- **Human (H2):** production `DATABASE_URL` (Neon `main`, pooled), `NEON_AUTH_BASE_URL` (the `main` branch auth URL), `NEON_AUTH_COOKIE_SECRET`, `CRON_SECRET` as secrets on `dontkillmyvibe`; add the production hostname to Neon Auth trusted origins; apply migrations to `main` (`DATABASE_URL=… pnpm db:migrate`, brings it from 11 to 12 migrations).
- Agent: add a CircleCI job `deploy-staging` (runs after `verify` and `workers-build` on the default branch): `pnpm cf:build && pnpm exec wrangler deploy --env staging`. Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as CircleCI project env vars (human adds them).
- Agent: add a manual-approval `deploy-production` job (CircleCI `type: approval`) using `--env production`.
- Agent: write `docs/runbooks/rollback.md`: how to `wrangler rollback`, how to flip a source switch off (S04), how to disable cron (set `crons: []` and redeploy), how to restore Neon (branch reset / snapshot).
- Rehearse: deploy a deliberately broken version to staging, roll back, record the time it took.

## Acceptance criteria
- [ ] Production `/api/cron/tick` returns 200 with the production secret.
- [ ] CircleCI deploys staging on merge to default; production requires a click.
- [ ] Rollback rehearsal documented with timings.
- [ ] Production cron enabled only after S00 acceptance has held for 24 hours.
- [ ] README of the repo "Deploy" section updated to match.

## Out of scope
Custom domain DNS (human), blue/green, any feature work.

## Gotchas
`wrangler.jsonc` has `env.staging` and `env.production`; the top-level worker is also `dontkillmyvibe`. Do not enable cron at top level. CI `workers-build` must keep running without secrets (it fails if `DATABASE_URL`/`NEON_AUTH_*` are present).
