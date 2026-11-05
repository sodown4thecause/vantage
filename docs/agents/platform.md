# Platform reference for agents

Reference detail moved out of `AGENTS.md` on 6 November 2026 so the always-loaded
file stays short. `AGENTS.md` holds the rules; this page holds the facts behind
them. When the two disagree, `AGENTS.md` wins and this page needs fixing.

## Choosing a HumanLayer workflow

When HumanLayer runs a task, pick the shortest workflow that gives the task the
review points it needs. HumanLayer's `/rpi:*` skills own Clarify, Plan and Do.

| Task | Workflow |
|------|----------|
| Small change with a clear result | Oneshot |
| Needs research and one design discussion | RPI |
| Needs separate product and technical designs | PRD-Oriented |
| No fixed phases, such as ops or a one-off question | Freeform |

Don't install another phase framework (compound-engineering, gstack, spec-kit,
BMAD or similar): their skills overlap and fight over the same stages.

## Greptile

- Configuration lives in `.greptile/config.json` and is read from the PR's
  **source** branch, so changes only affect new PRs. It reviews on open and
  push (`autoReview: ["open", "push"]`), skips drafts, ignores `*.md`, and posts
  a summary comment, inline comments with P0–P2 severity, and a status check.
- The check run is named `Greptile Review`. It fails when the confidence score
  is below 4/5, even though the review itself ran successfully.
- It is not a required check in branch protection. The free Starter plan
  allows 50 credits a month for one active developer, and when credits run out
  Greptile posts no check run at all, which would block every merge if it were
  required. The merge rule in `AGENTS.md` decides what happens when a review is
  missing. Revisit once credit headroom is confirmed.

## Branch protection (GitHub → Settings → Rules)

- `main` requires the `CI` checks (`Lint, typecheck, test, build` and
  `Cloudflare Worker bundle (no secrets)`), linear history, and no force-push
  or deletion. These rules also apply to admins.
- No human approval is required, because agents merge their own PRs and GitHub
  doesn't let an author approve their own PR. There is no CODEOWNERS file.
- Neither reviewer's status check is required (see Greptile above).
- Don't add restrictions that would lock the sole founder out of their own repo.

## Cloudflare Workers

- **Plan and limits**: Workers Paid (US$5/month floor). 30 s CPU per HTTP
  request, configurable; 15 min CPU and wall time for Cron Triggers on
  intervals of 1 h or more (30 s CPU below that); Worker size 64 MiB
  uncompressed, with no compressed limit; 128 MB per isolate; 10,000
  subrequests by default. Waiting on `fetch` or database calls doesn't count as
  CPU. The CI size gate (10 MB compressed) is this repo's own guardrail, stricter
  than the platform limit.
- **Config**: `wrangler.jsonc`. Worker `dontkillmyvibe`, custom entry
  `worker-entry.mjs`, `compatibility_date` plus `nodejs_compat` and
  `global_fetch_strictly_public` (Cloudflare refuses outbound fetches that
  resolve to private networks, part of the SSRF defence). Bindings: `ASSETS`
  (static assets), `WORKER_SELF_REFERENCE`, `BROWSER`, `AI`, `VECTORIZE`,
  `ARTIFACTS` (R2), `SCAN` (Workflows), `RADAR_LIMITER` (rate limiting),
  `EMBED_QUEUE` (Queues producer; the Worker also consumes the queue, with a
  dead-letter queue, in each environment).
- **Routes**: `contextfor.dev` and `www.contextfor.dev` as custom domains;
  `workers_dev` is false. Staging is a separate environment and Worker
  (`vantage-staging`) and must not inherit production custom domains.
- **Cron**: `worker-entry.mjs` adds the scheduled handler. With `SCAN`, it
  starts scan Workflows, rolls up costs, then calls `/api/cron/digest`; without
  `SCAN`, `/api/cron/tick` handles the sweep. Self-fetches use
  `WORKER_SELF_REFERENCE` and `Authorization: Bearer ${CRON_SECRET}`.
  Production runs hourly (`0 * * * *`, set at the top level and under
  `env.production`); staging runs every three hours (`0 */3 * * *`). Changing
  the production schedule needs Liam.
- **Runtime rules**: fetch-only database access; no Node-only APIs beyond what
  `nodejs_compat` provides (`node:crypto` and `Buffer` are fine); no long-lived
  connections or in-process timers; global scope under the 1 s startup CPU
  budget.
- **Builds**: `pnpm cf:build` and `pnpm cf:preview` run the real Worker
  runtime; `pnpm dev` runs Next on Node. On native Windows, pnpm's default
  linked `node_modules` layout makes the OpenNext build fail with `EPERM`,
  because creating symlinks needs Developer Mode or admin rights. The repo pins
  `nodeLinker: hoisted` in `pnpm-workspace.yaml`, a flat layout that avoids
  them. If the build still fails, build on Linux, WSL or CI.

## Neon Postgres

- **Runtime** uses the pooled (`-pooler`) `DATABASE_URL` through the
  `neon-http` driver: one HTTP request per query, no pool to manage, no
  interactive transactions. Use atomic statements or `db.batch()` when several
  statements must go together.
- **Migrations** run against the **direct** (non-pooler) endpoint, because
  transaction-mode pooling doesn't support session-level features. CI only
  checks for migration drift (`pnpm db:generate`, then
  `git diff --exit-code -- drizzle`); it doesn't apply migrations to a
  database. Prove a migration on a Neon branch.
- **Hyperdrive seam** (`lib/db/client.ts`, only when
  `VANTAGE_DB_DRIVER=hyperdrive`; otherwise everything uses neon-http):
  - Use the scoped helpers `withReadDb()` (cached reads, for public read pages)
    and `withFreshDb()` (leases, budgets, switches, read-after-write). They
    close the Hyperdrive pool when the callback settles. `getReadDb()` and
    `getFreshDb()` leave a `postgres-js` pool open under Hyperdrive.
  - `withTransaction()` throws on the default neon-http driver. It needs the
    Hyperdrive driver and the `HYPERDRIVE_FRESH` binding.
- **Neon Auth** (Managed Better Auth) is constructed lazily: `lib/auth/server.ts`
  wraps `auth` in a Proxy, and `app/api/auth/[...path]/route.ts` calls
  `auth.handler()` inside its `GET` and `POST`, at request time. The Proxy
  alone doesn't make `export const { GET, POST } = auth.handler()` safe: that
  builds the client at module scope and fails any build without
  `NEON_AUTH_BASE_URL`. Don't move `requiredEnv` or `auth.handler()` to module
  scope.
- **Operations**: enable autoscaling and PITR, keep `max_connections` in mind
  when sizing any future pool, and rehearse a restore before relying on it.
  Retention and deletion of customer data is a launch requirement.

## Migrations

- `drizzle-kit generate` can rewrite `drizzle/meta/_journal.json` even with no
  schema change. That churn is expected, and the CI drift gate compares
  `drizzle` as a whole, so never hand-edit generated files to make it pass.
- Additive only (expand, then contract in a later release). Worker rollbacks
  assume the previous deploy still works against the current schema.

## Fixtures and sample data

Fixture sample data fails closed in production unless `ALLOW_FIXTURES` is set.
Documents carry `metadata.provider` and `metadata.mocked` so the UI can label
sample data honestly.

## Test tooling

- Unit and contract tests: `pnpm test` (Vitest) plus the `node --test` Worker
  entry tests. Workspace boundaries are proven in tests such as
  `test/workspace-authorization.test.ts` and `test/queue-visibility.test.ts`.
- End-to-end journeys: Playwright CLI (`playwright-cli`, installed globally
  with `npm install -g @playwright/cli@latest`) driving the real app as a user,
  per `.agents/skills/verify-ui`. There is no Playwright test-runner dependency
  in `package.json`.
- Dataflow: throwaway scripts in `scripts/scratch/` (gitignored), per
  `.agents/skills/verify-dataflow`. A bug they find becomes a test in `test/`.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, Vitest and node tests,
  the migration drift gate, the build, and the Cloudflare Worker bundle job.
