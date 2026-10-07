# S01 — Production promotion, rollback, CI deploy

**Track:** Platform · **Wave:** 0 · **Size:** M · **Owner:** agent + human (H2) · **Depends on:** S00 · **Unblocks:** any production release

## Outcome
Production Worker `dontkillmyvibe` runs the same bundle as staging against Neon `main`, with a rehearsed rollback and an automated staging deploy on merge.

## Scope
- **Human (H2):** production `DATABASE_URL` (Neon `main`, pooled), `NEON_AUTH_BASE_URL` (the `main` branch auth URL), `NEON_AUTH_COOKIE_SECRET`, `CRON_SECRET` as secrets on `dontkillmyvibe`; add the production hostname to Neon Auth trusted origins; apply migrations to `main` (`DATABASE_URL=… pnpm db:migrate`, applies every pending migration: at the time of writing 0011 to 0015, taking `main` from 11 to 16 migrations; list `drizzle/` and the `drizzle.__drizzle_migrations` table first and state the exact range in the PR). The workflow's `run_migrations` input may do this instead.
- Agent: CI is GitHub Actions (there is no CircleCI). `.github/workflows/deploy.yml` already deploys staging after CI passes on main and production on manual `workflow_dispatch`. Verify and, where needed, harden it rather than adding a second pipeline: staging deploy runs `pnpm cf:build && pnpm exec wrangler deploy --env staging`; production uses the `production` GitHub environment with required reviewers as the approval gate (human enables it in Settings > Environments). Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as Actions secrets (human adds them).
- Agent: write `docs/runbooks/rollback.md`: how to `wrangler rollback`, how to flip a source switch off (S04), how to disable cron (set `crons: []` and redeploy), how to restore Neon (branch reset / snapshot).
- Rehearse: deploy a deliberately broken version to staging, roll back, record the time it took.

## Acceptance criteria
- [ ] Production `/api/cron/tick` returns 200 with the production secret.
- [ ] GitHub Actions `deploy.yml` deploys staging after CI on merge to default; production requires a manual run plus environment approval (evidence: run links in the PR).
- [ ] Rollback rehearsal documented with timings.
- [ ] Production cron enabled only after S00 acceptance has held for 24 hours.
- [ ] README of the repo "Deploy" section updated to match.

## Out of scope
Custom domain DNS (human), blue/green, any feature work.

## Gotchas
`wrangler.jsonc` has `env.staging` and `env.production`; the top-level worker is also `dontkillmyvibe`. Do not enable cron at top level. CI `workers-build` must keep running without secrets (it fails if `DATABASE_URL`/`NEON_AUTH_*` are present).
