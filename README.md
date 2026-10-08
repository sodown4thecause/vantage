# Vantage

Social listening / lead capture platform (M1 scaffold).

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind
- **Neon** Postgres via **Drizzle ORM**
- **Neon Auth** (Managed Better Auth)
- Free-lane **Collector** interface for HN / RSS / Substack workers

## Setup

```bash
pnpm install
cp .env.example .env.local
# Fill DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET
pnpm db:migrate   # applies drizzle/0000_m1_core.sql
pnpm dev
```

### Neon project

1. Create a Neon project and enable **Managed Better Auth**.
2. Copy the pooled `DATABASE_URL` and Auth base URL into `.env.local`.
3. Generate a cookie secret: `openssl rand -base64 32`.

## M1 schema

Tables in `lib/db/schema.ts`:

| Table | Purpose |
|-------|---------|
| `workspace` | Tenant + plan/budget/consents |
| `source` | Collector feeds (etag/cursor/config) |
| `document` | Normalized collected content |
| `lead` | Scored opportunities tied to documents |

## Collectors & pipeline

| Route | Purpose |
|-------|---------|
| `POST /api/collectors/hn` | Hacker News (Algolia + Firebase) |
| `POST /api/collectors/rss` | RSS/Atom with conditional GET |
| `POST /api/collectors/substack` | Substack publication feed |
| `POST /api/collectors/producthunt` | Product Hunt via TinyFish **Search+Fetch** (agent last), else PH GraphQL, else fixture |
| `POST /api/collectors/youtube` | YouTube via **Scavio** comments scrape, else TinyFish Fetch/Search, else agent, else Data API, else fixture |
| `POST /api/collectors/reddit` | Reddit via **Scavio** `reddit.search` (`SCAVIO_API_KEY`), else fixture |
| `POST /api/collectors/x` | X/Twitter via **Scavio** `x.search` (`SCAVIO_API_KEY`), else fixture |
| `POST /api/pipeline/run` | Normalize + intent ladder → leads |
| `GET /api/cron/tick` | 3-hour Vercel cron: all sources + pipeline |
| `/review?workspaceId=` | Lead review UI |

Body for collector routes: `{ "workspaceId": "...", "sourceId": "..." }`.

### Scrape providers

Prefer **search + fetch/scrape** over full browser agents. **Scavio is enough** for Reddit/X/YouTube structured APIs.

1. **YouTube order:** Scavio comments → TinyFish Fetch/Search → TinyFish Agent → `YOUTUBE_API_KEY` → fixture.
2. **Product Hunt order:** TinyFish Search+Fetch → homepage Fetch → TinyFish Agent → `PH_DEV_TOKEN` → fixture.
3. **Reddit:** Scavio `client.reddit.search` (`config.query`, `config.limit`) → fixture.
4. **X:** Scavio `client.x.search` (`config.query`, `config.searchType`, `config.limit`) → fixture.
5. Documents store `metadata.provider` (`scavio`, `tinyfish_*`, native APIs, or `fixture`).
6. Optional: deploy [arcade-scavio](https://pypi.org/project/arcade-scavio/) on Arcade if you want the same Scavio tools as MCP (`Scavio.SearchReddit`, etc.). Vantage talks to Scavio directly.

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Next dev server |
| `pnpm build` | Production Next build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest suite |
| `pnpm db:generate` | Generate migrations from schema |
| `pnpm db:migrate` | Apply migrations (run manually — see Deploy) |
| `pnpm db:push` | Push schema (dev) |
| `pnpm cf:build` | Build the Cloudflare Worker bundle |
| `pnpm cf:preview` | Build and preview locally on Workers |
| `pnpm deploy` | Build and deploy to Cloudflare |
| `pnpm cf:typegen` | Generate `cloudflare-env.d.ts` bindings |

## Deploy (Cloudflare Workers)

Vantage runs on Workers via `@opennextjs/cloudflare`. Config lives in
`wrangler.jsonc` and `open-next.config.ts`; `worker-entry.mjs` is the Worker
entrypoint.

`compatibility_date` is `2026-10-05`, so `nodejs_compat` is enabled implicitly and
`node:crypto` / `Buffer` / `process.env` work without extra flags.

### One-time setup

```bash
pnpm install
wrangler login
wrangler secret put CRON_SECRET              # 32+ random bytes
wrangler secret put NEON_AUTH_COOKIE_SECRET  # 32+ chars
wrangler secret put DATABASE_URL             # Neon pooled connection string
```

`NEON_AUTH_BASE_URL` must be a **real, reachable** Neon Auth URL. A placeholder
value builds green and then fails every login at runtime.

### Migrations are a deliberate manual step

`pnpm db:migrate` is **not** chained into `pnpm deploy`. Apply migrations to the
verified staging database before accepting features that use the new schema.
Run production migrations deliberately against the confirmed production target:

```bash
DATABASE_URL="postgresql://…" pnpm db:migrate
```

### Cloudflare branch previews

`wrangler.jsonc` includes the [required `previews` block](https://developers.cloudflare.com/workers/previews/configuration/).
Its [custom build command](https://developers.cloudflare.com/workers/wrangler/custom-builds/)
runs `pnpm run cf:build` before Wrangler bundles the preview, so the dashboard's
`pnpm run build` followed by `npx wrangler preview` produces `.open-next` assets.
The package's `build` remains `next build`, avoiding a recursive build hook.
Named staging and production configurations override the hook with an empty command,
because CI already runs the explicit OpenNext build before their uploads. Build
with `pnpm cf:build` before using raw Wrangler commands with those environments.

Configure preview-specific test database and auth secrets in Previews Base before
testing authenticated flows. The empty preview block copies no production bindings
or routes. Preview service bindings call the target Worker's production deployment,
so add only verified test services. Previews do not run cron. Builds never apply migrations.

### Deploy

```bash
pnpm deploy
```

### Cron

The `staging` environment schedules `0 */3 * * *` (every 3 hours, UTC);
top-level and production cron lists are empty. The adapter emits
only a `fetch` handler, so `worker-entry.mjs` adds a `scheduled` handler that
reaches the tick route through the `WORKER_SELF_REFERENCE` service binding with
`Authorization: Bearer ${CRON_SECRET}`. This reuses the single deployed bundle and
the existing constant-time check in `lib/cron/authorize.ts` rather than duplicating
the collector pipeline into a second entrypoint.

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

## Ref orchestration

See `.warp/REF_ORCHESTRATOR_SETUP.md` for Warp Oz ↔ Ref Plans wiring.
