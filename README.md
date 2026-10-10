# [Vantage](https://contextfor.dev)

**Find the people already asking for what you build.**

Vantage reads Reddit, Hacker News, X, YouTube, Product Hunt, Substack and your
own feeds, scores what it finds for buying intent, and puts the handful of
conversations worth joining in front of you each morning. You write the reply —
Vantage never posts on your behalf.

- App: **https://app.contextfor.dev** · Marketing: **https://contextfor.dev**

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind v4
- **Neon** Postgres via **Drizzle ORM** (`neon-http` driver — fetch only, no
  connection pool to manage)
- **Neon Auth** (Managed Better Auth)
- **Cloudflare Workers** (Paid) via OpenNext — custom domain, Cron Trigger for
  the sweep, Workers static assets
- **Resend** for the daily digest
- **Greptile** for AI pull-request review, **GitHub Actions** for CI/CD

## The product journey

1. **Sign up** → create a workspace (one per product or brand you monitor).
2. **Add sources** → RSS/Atom feeds, Substack publications, or search queries
   for Hacker News, Reddit, X, YouTube and Product Hunt. Every source shows
   health and last-poll time, and can be paused.
3. **Collect** → press *Collect now* on a source, or wait for the scheduled
   sweep (every 3 hours). Each collector records which provider produced the
   data, and fixture sample data is refused in production.
4. **Review** → leads are ranked by intent, with the original post, the reason
   it scored, and the provider it came from. Approve or reject, and record
   whether the lead was actually useful.
5. **Daily digest** → up to five top-ranked conversations, emailed once a day
   at your chosen hour.

Pages: `/` (workspaces), `/sources`, `/review`, `/settings` (digest, unsubscribe).

## Data model

Tables in [`lib/db/schema.ts`](lib/db/schema.ts):

| Table | Purpose |
|-------|---------|
| `workspace` | Tenant, owner (Neon Auth user), plan, digest preferences |
| `source` | Collector feeds: type, config, health, etag/cursor, last poll |
| `document` | Normalized collected content, deduped by content hash |
| `lead` | Scored opportunity tied to a document, with review status |
| `opportunity_outcome` | Was this lead useful / not useful / acted on |

Migrations live in [`drizzle/`](drizzle) and are additive only
(expand/contract), so a Worker rollback always works against the live schema.

## Collectors

| Type | Order |
|------|-------|
| `rss` | Direct fetch with conditional GET (ETag / `If-Modified-Since`) |
| `substack` | Publication feed via the RSS collector |
| `hn` | Algolia search + Firebase item enrichment |
| `reddit` | Scavio `reddit.search` → fixture (fixtures blocked in production) |
| `x` | Scavio `x.search` → fixture |
| `youtube` | Scavio comments → TinyFish Fetch/Search → TinyFish agent → YouTube Data API → fixture |
| `producthunt` | TinyFish Search+Fetch → homepage fetch → agent → PH GraphQL → fixture |

Every document stores `metadata.provider` and `metadata.mocked`, and the review
queue shows both — sample data can never pass itself off as a real lead.

User-supplied feed URLs go through `lib/collectors/safeFetch.ts`: only public
http(s), no embedded credentials, no loopback/private/link-local/cloud-metadata
hosts, redirects re-validated per hop, plus request timeout and response size
caps.

Multitenancy is enforced at the query layer and proven by
[`test/tenant-isolation-sweep.test.ts`](test/tenant-isolation-sweep.test.ts):
anonymous and cross-workspace callers are refused with zero database writes.

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
`CRON_SECRET` to protect the sweep, `ALLOW_FIXTURES` to permit sample data.

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` / `build` / `start` | Next dev server / build / start |
| `pnpm test` | Unit + contract tests (Vitest) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` / `db:migrate` / `db:push` | Drizzle migrations |
| `pnpm cf:build` / `cf:deploy` / `cf:preview` | OpenNext build + Wrangler deploy |

## Deployment

Cloudflare Workers, configured in [`wrangler.jsonc`](wrangler.jsonc):
`app.contextfor.dev` custom domain, Workers static assets, `nodejs_compat`,
observability, and a 3-hourly Cron Trigger for the sweep. CI/CD is
[`.github/workflows`](.github/workflows): `ci.yml` runs lint → typecheck →
tests → migration drift → build on every PR, plus workflow linting;
`deploy-staging.yml` deploys every PR and comments the URL; `deploy-prod.yml`
deploys `main` behind a required reviewer. Migrations in CI use the direct
(non-pooled) Neon endpoint; the runtime uses the pooled one.

## Contributing

See [AGENTS.md](AGENTS.md) for the standard loop, tenant-safety rules,
migration conventions, secrets handling, and how Greptile reviews PRs.
