# AGENTS.md

Working agreement for humans and coding agents in this repository.

## The product in one paragraph

Vantage reads Reddit, Hacker News, X, YouTube, Product Hunt, Substack and
customer RSS feeds, scores what it finds for buying intent, and puts the
handful of conversations worth joining in front of the workspace owner. The
owner writes the reply — Vantage never posts on anyone's behalf. Production
runs on Cloudflare Workers (Paid) with Neon Postgres; the marketing site stays
at contextfor.dev and the app is served from app.contextfor.dev.

## The standard loop

1. Branch: `git switch -c <type>/<short-slug>` (types: feat, fix, chore, docs,
   test, refactor, perf, ci).
2. Implement. Every new query or mutation is workspace-scoped — if it touches
   the database, it must be provable from the tenant-isolation sweep in
   `test/tenant-isolation-sweep.test.ts`.
3. Verify locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
4. Push and open a PR. `ci.yml` must be green: lint, typecheck, tests, schema
   drift, build, plus workflow linting.
5. Greptile reviews the PR automatically once it is marked ready (drafts are
   skipped). Fix what is real; re-review happens automatically on push.
6. Merge once CI is green and CODEOWNERS have approved the paths they own.

## Greptile code review

Greptile reviews every PR with codebase context (GitHub App
`greptile-apps`, already installed).

- Configuration lives in `.greptile/config.json` and is read from the PR's
  **source** branch, so changes only affect new PRs.
- It reviews automatically when a PR is opened or updated
  (`autoReview: ["open", "push"]`); drafts are skipped. Ask for a review
  manually by commenting `@greptileai` on any PR.
- Findings arrive as a summary comment plus inline comments with P0–P2
  severity, and as a status check (`statusCheck: true`).
- Ignore patterns and custom rules (tenant scoping, auth-before-write, fetch
  policy, secrets, additive migrations) are configured in `.greptile/config.json`.

Keep the status check **advisory**: the free Starter plan allows 50 credits
per month for one active developer, and once credits run out Greptile posts no
check run at all — which would block every merge if the check were required.
Decide whether to require it only after confirming credit headroom and the
exact check-run name in this repo's Checks list.

## Branch protection (apply in GitHub → Settings → Rules)

- `main` is protected: required checks `ci / verify` (and `ci / workflow-lint`),
  one approval, dismiss stale reviews, no force-push, linear history.
- CODEOWNERS approval required for `lib/db/**`, `lib/auth/**`, `lib/outcomes/**`,
  `drizzle/**`, `lib/collectors/**`, `.github/workflows/**`, `.greptile/**`.
- The Greptile status check is **advisory for now**: the free Starter plan
  allows 50 credits/month for one active developer, and when credits run out
  Greptile posts no check run at all — which would block merges if required.
- Self-approval is allowed by default; do not add restrictions that would lock
  the sole founder out of their own repo.

## Migrations

- Generate: `pnpm db:generate`. Commit the SQL **and** the matching snapshot.
- `drizzle-kit generate` rewrites `drizzle/meta/_journal.json` on every run,
  even with no schema changes. That churn is expected; do not commit it as a
  "fix", and the CI drift gate deliberately ignores it.
- Additive only (expand/contract): add columns and tables now, drop the old
  ones in a later release. Worker rollback assumes the previous deploy still
  works against the current schema.
- Runtime uses the pooled connection string; migrations run against the
  direct (non-pooler) endpoint.

## Secrets

- Never commit a credential. `.env.local` (and its backups) is ignored;
  `.env.example` holds placeholders only.
- Runtime secrets live in Cloudflare (Workers secrets) and GitHub
  (Actions secrets / Environments). Locally use `.dev.vars` for Workers and
  `.env.local` for Next.
- `test/secrets-hygiene.test.ts` and the gitleaks workflow enforce this; do
  not bypass them.
- Keys shared in chat or tickets must be rotated — the workspace owner rotates
  in the provider dashboard.

## Environments and deploy

- `staging` and `production` GitHub Environments gate deploys; production
  requires a reviewer.
- `deploy-staging.yml` deploys per PR and comments the URL; `deploy-prod.yml`
  deploys `main` to app.contextfor.dev.
- Required secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
  (workflows); everything else is a Worker secret set with
  `wrangler secret put`.

## Scheduled work

- The sweep is a Cloudflare Cron Trigger (`scheduled()` handler), interval
  ≥ 1 hour so it keeps the 15-minute CPU/wall budget on the Paid plan.
- It collects from every source, runs the pipeline, then dispatches due daily
  digests. A failure in one source or workspace never aborts the sweep.

## Verification without Playwright

This repo has no Playwright test runner. End-to-end journeys are driven
through the agent browser (agent-browser MCP) against staging, and scripted
checks use the Playwright CLI (`npx playwright ...`) rather than adding a test
framework dependency.
