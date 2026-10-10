# [Vantage](https://contextfor.dev)

**Find the people already asking for what you build.**

Vantage reads Reddit, Hacker News, X, YouTube, Product Hunt, Substack, GitHub,
Stack Overflow, LinkedIn and your own feeds, scores what it finds for buying
intent, and puts the conversations worth joining in front of the workspace
owner. You write the reply — Vantage never posts on your behalf.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind v4
- **Neon** Postgres via **Drizzle ORM** (`neon-http` driver, pooled endpoint)
- **Neon Auth** (Managed Better Auth), constructed lazily so builds need no secrets
- **Cloudflare Workers** — custom domain `contextfor.dev`, static assets,
  Cron Trigger, Browser / AI / Vectorize / R2 / Workflows bindings
- **Greptile** for AI pull-request review, **GitHub Actions** for CI/CD

## The product

| Surface | What it does |
|---------|--------------|
| Sign-up / onboarding | Create a workspace per product or brand you monitor |
| Sources | Collector feeds with health, last-poll time, pause/resume and per-collector validation |
| Collect | Manual run per source, or the scheduled sweep |
| Queue / review | Leads ranked by intent, with the original post, the reason it scored and the provider it came from; approve, reject and record outcomes |
| Settings | Plan, sources and digest delivery |
| Daily digest | Up to five top-ranked conversations, emailed once a day at your chosen hour |

Documents store `metadata.provider` and `metadata.mocked`, and the UI shows
both — fixture sample data can never pass itself off as a real lead. Collectors
fail closed before saving fixtures in production unless `ALLOW_FIXTURES=true`
explicitly permits an intentional demo. Other values do not opt in. Persisted
samples stay marked as mocked, their source coverage stays degraded, and they
remain excluded from the live opportunity queue.

## Data model

Tables live in [`lib/db/schema.ts`](lib/db/schema.ts): `workspace`, `source`,
`document`, `lead`, `opportunity_outcome`, plus the opportunity/budget/scan and
distribution tables used by the sweep engine. Migrations in
[`drizzle/`](drizzle) are additive only (expand/contract), so a Worker rollback
always works against the live schema.

## Collectors

| Type | Order |
|------|-------|
| `rss` | Direct fetch with conditional GET (ETag / `If-Modified-Since`) through `fetchPublicText` |
| `substack` | Publication feed via the RSS collector |
| `hn` | Algolia search + Firebase item enrichment |
| `reddit` | Scavio `reddit.search` → fixture |
| `x` | Scavio `x.search` → fixture |
| `youtube` | Scavio comments → TinyFish Fetch/Search → agent → YouTube Data API → fixture |
| `producthunt` | TinyFish Search+Fetch → homepage fetch → agent → PH GraphQL → fixture |
| `github`, `stackoverflow`, `linkedin`, `alexandria` | Native APIs and search |

Every user-supplied URL goes through
[`lib/http/public-fetch.ts`](lib/http/public-fetch.ts): public http(s) only, no
embedded credentials, no loopback/private/link-local/cloud-metadata hosts,
manual redirect handling, timeout and streaming size caps — on top of
Cloudflare's `global_fetch_strictly_public` DNS protection.

Multitenancy is enforced at the query layer. Coverage includes
[`test/workspace-authorization.test.ts`](test/workspace-authorization.test.ts),
[`test/queue-visibility.test.ts`](test/queue-visibility.test.ts), and
[`test/digest-actions.test.ts`](test/digest-actions.test.ts); refused digest
mutations never reach the database.

## Setup

```bash
pnpm install
cp .env.example .env.local
# Fill DATABASE_URL (pooled), NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET
pnpm db:migrate
pnpm dev
```

Optional: collector keys (`SCAVIO_API_KEY`, `TINYFISH_API_KEY`,
`PH_DEV_TOKEN`, `YOUTUBE_API_KEY`), `RESEND_API_KEY` for digests,
`CRON_SECRET` to protect the sweep, `ALLOW_FIXTURES=true` to permit sample data.

Set `NEXT_PUBLIC_APP_URL` to each deployment's own origin (including staging).
Production-mode digest dispatch fails closed if it is unset; local development
defaults to `http://localhost:3000`. Configure `DIGEST_FROM_ADDRESS` with a verified
Resend sender and optionally `DIGEST_FROM_NAME`.

Digest dispatch isolates workspace failures: selection, delivery or last-sent
recording errors count as failures without stopping other workspaces. Skipped or
rejected sends never update the last-sent timestamp.

Digests select the active opportunity queue, not legacy leads: current monitoring
profile, live same-workspace evidence, updated in the last 24 hours, ranked up to
five entries. Email destinations use the same HTTP(S)-only policy as the app.
The preferred UTC hour identifies a daily slot; the next cron catches up an
elapsed slot across midnight, without sending it twice or less than 20 hours
after the previous digest. First-time subscribers catch up the latest elapsed
slot because preferences do not store an activation timestamp.

Each sweep handles at most 25 eligible workspaces, oldest attempt first, with a
90-second shared time budget and a 10-second email request timeout. `hasMore`
reports batch/deadline deferral; later cron runs continue fairly, including when
empty or failing workspaces remain due. A dedicated atomic lease serializes
delivery per workspace; token-fenced completion cannot overwrite a newer claim.

Resend requests use a stable delivery idempotency key derived from the workspace
and previous successful send. Resend retains keys for 24 hours. If email is
accepted but recording fails, an unchanged retry is deduplicated within that
window; a changed payload can be rejected as a conflict and remains failed.
This is not an exactly-once guarantee across crashes or the provider retention
window. Never manually replay uncertain deliveries without checking provider
status.

### Neon project

1. Create a Neon project and enable **Managed Better Auth**.
2. Copy the pooled `DATABASE_URL` and the Auth base URL into `.env.local`.
   Migrations use the direct (non-pooler) endpoint.
3. Generate a cookie secret: `openssl rand -base64 32`.

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` / `build` / `start` | Next dev server / build / start |
| `pnpm test` | Vitest suite |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` / `db:migrate` / `db:push` | Drizzle migrations |
| `pnpm cf:build` / `cf:preview` / `deploy` | OpenNext build + Wrangler preview/deploy |

Worker entry tests run separately: `node --test test/worker-entry.test.mjs
test/scan-run.test.mjs test/queue-consumer.test.mjs`.

## Deployment

Cloudflare Workers, configured in [`wrangler.jsonc`](wrangler.jsonc):
`contextfor.dev` and `www.contextfor.dev` custom domains, Workers static
assets, `nodejs_compat` + `global_fetch_strictly_public`, observability, and
the Browser / AI / Vectorize / R2 / Workflows / rate-limit bindings.

CI/CD lives in [`.github/workflows`](.github/workflows): `CI` runs lint,
typecheck, tests, migration drift and build on every PR and push, plus a job
that measures the Worker bundle against the 10 MB limit and fails the build if
a Worker ever needs secrets again.

Before deploying this change, apply the additive digest migrations to the target
database using its direct Neon endpoint. Automatic staging deployment does not
run migrations; use the manual Deploy workflow with **run migrations** enabled
for the intended environment. Set that environment's `NEXT_PUBLIC_APP_URL` before
enabling digest delivery. Keep production deployment gated until the schema and
runtime configuration are verified.

The Cloudflare Git integration runs independently of GitHub Actions. Verify its
production branch, preview isolation and commands in the dashboard; the manual
production gate in `deploy.yml` does not govern that separate integration.

```bash
pnpm deploy
```

### Cron

The `staging` environment schedules `0 */3 * * *` (every 3 hours, UTC);
top-level and production cron lists are empty. `worker-entry.mjs` adds the
`scheduled` handler missing from the adapter. With the configured `SCAN` binding,
it starts per-workspace scan Workflows, requests cost rollup, then POSTs to
`/api/cron/digest`. Without `SCAN`, it calls `/api/cron/tick`, which performs the
scan, rollup and digest sweep itself. Both paths use `WORKER_SELF_REFERENCE` and
`Authorization: Bearer ${CRON_SECRET}`; digest failures do not fail scan scheduling.

Worker script limits are 3 MB (Free) and 10 MB (Paid). CI measures
`.open-next/worker.js` and fails the build above 10 MB.

### Local development notes

- `pnpm dev` runs the Next dev server on Node, not Workers. Use `pnpm cf:preview`
  to exercise the real Worker runtime.
- On native Windows, `opennextjs-cloudflare build` calls `fs.symlinkSync`, which
  needs Developer Mode or elevation; without it the build fails with `EPERM` from
  the default linked pnpm layout recreating `.pnpm` virtual-store symlinks. This
  repo commits `nodeLinker: hoisted` in `pnpm-workspace.yaml` as the chosen fix: a
  hoisted install writes a flat `node_modules` with no symlinks, so OpenNext copies
  files instead of recreating symlinks. Alternatively, run the build on Linux (WSL,
  Docker, or CI). See
  [docs/operations/2026-10-08-cloudflare-worker-build-and-domain.md](docs/operations/2026-10-08-cloudflare-worker-build-and-domain.md).
- Operational caveat: a hoisted install copies every platform variant of native
  packages such as sharp's libvips instead of hardlinking them, so it uses more
  disk than the default linked layout. Budget for that in CI caches; it does not
  affect correctness of the build.
- The build requires no secrets. `lib/auth/server.ts` and `app/api/auth/[...path]/route.ts`
  both defer Neon Auth construction to request time, and CI has a job that fails if
  the build ever needs `NEON_AUTH_*` again.

## Contributing

See [AGENTS.md](AGENTS.md) for the standard loop, the Superpowers workflow,
available MCP servers (agent-browser, Supermemory, Greptile), Cloudflare and
Neon operating rules, security invariants, migration conventions and how
Greptile reviews PRs.

## Ref orchestration

See `.warp/REF_ORCHESTRATOR_SETUP.md` for Warp Oz ↔ Ref Plans wiring.
