# [contextfor.dev](https://contextfor.dev)

**One low-effort workspace for getting a product found: community listening, SEO, AI visibility (GEO) and content.**

Vantage (the product behind contextfor.dev) replaces the separate listening, SEO,
AI-visibility, link-building and content tools a founder would otherwise stitch
together. You describe your product once, through a short AI interview, and the
workspace keeps working in the background:

- **GTM lane.** Reads Reddit, Hacker News, X, YouTube, Product Hunt, Substack,
  GitHub, Stack Overflow, LinkedIn and your own feeds. It scores every
  conversation on fit, intent, evidence, momentum and timing, then emails up to
  five ranked conversations a day that are worth joining, each with a grounded
  draft reply. **You write and post the reply. Vantage never posts for you.**
- **SEO and GEO lane.** An AI agent over DataForSEO and Google Search Console
  data covers keywords, SERPs, backlinks and referring domains. It also checks
  whether answer engines (ChatGPT, Perplexity, Google AI Overviews) cite you.
  Paid calls need your approval before they run.
- **Content lane.** Turns what the listening and SEO lanes find into posts and
  social copy, grounded in your own knowledge base and run through a humaniser.
  Vantage writes the social content but doesn't schedule or post it. It points
  you to open-source schedulers instead.
- **AI workspace.** A single chat with three suggested prompts at all times.
  Answers come back as text plus visuals (rendered threads, backlink tables and
  graphs), and anything worth keeping is saved as an artifact.

## How it works

1. **Onboard from a URL.** Paste your site and the interview drafts your
   monitoring profile (audience, problems, competitors, sources) for you to
   confirm.
2. **Scan.** An hourly Cloudflare Cron starts one durable Workflow per due
   workspace. Collectors fetch new conversations within a daily paid-provider
   budget.
3. **Rank.** Documents are embedded, deduplicated and scored. A learning loop
   re-weights ranking from your approvals, rejections and outcomes.
4. **Ground and draft.** Retrieval-augmented generation (RAG) pulls the most
   relevant passages from your knowledge base so a draft cites real evidence
   rather than inventing it.
5. **Deliver.** A daily digest arrives at the hour you choose, and the
   workspace holds the full queue, the SEO/GEO agent and saved artifacts.

## Services and stack

| Area | Service | Status |
|------|---------|--------|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 | Live |
| Hosting | Cloudflare Workers via OpenNext: Cron, Workflows, Queues, R2, Browser Rendering, rate limiting | Live |
| Database | Neon Postgres + Drizzle ORM (additive migrations) | Live |
| Auth | Neon Auth (managed Better Auth), email OTP | Live |
| Billing | Polar: Pro at $19/mo (founding price), checkout, webhooks and customer portal | Live |
| AI | Vercel AI SDK 7 (tool calling with tool approval) through Vercel AI Gateway | Live |
| Embeddings + RAG | Workers AI embeddings (Qwen3) + Cloudflare Vectorize | Live |
| Embeddings + RAG (next) | Neon pgvector (halfvec) + pg_search hybrid search, Jina v5 embeddings and Jina reranker v3 | Planned |
| Research | Tako Search via AI Gateway, with Linkup as fallback | Live |
| SEO / GEO data | DataForSEO (Labs, SERP, Backlinks, AI Optimization), cached per workspace | Live |
| Search Console | Google Search Console OAuth for first-party SEO data | Planned |
| Collection | Scavio, TinyFish, Firecrawl, HN Algolia, YouTube Data API, Product Hunt GraphQL, RSS | Live |
| Transactional email | Resend (digests and account email from `updates.contextfor.dev`) | Live |
| Newsletter | MailerLite for opted-in newsletters (`news.contextfor.dev`) | Planned |
| Bot protection | Cloudflare Turnstile on public endpoints | Live |
| Product analytics | PostHog: funnel events and browser error tracking, proxied first-party | In review |
| Worker errors | Cloudflare Workers Issues (no SDK) | In review |
| CI/CD | GitHub Actions (lint, typecheck, tests, migration drift, bundle-size gate, staging auto-deploy, gated production) | Live |

## Roadmap

**Now (launch)**
- Production acceptance of the unified workspace and the AI interview onboarding
- Reddit lane through Firecrawl search, with Scavio hydration for the daily top five
- PostHog funnel and Workers Issues alerts
- Signed one-click digest unsubscribe (RFC 8058)

**Next**
- Move RAG to Neon pgvector + pg_search with Jina v5 embeddings and the Jina reranker
- Google Search Console connection, plus a public SEO/GEO case study with ourselves as client zero
- Link enrichment and week-over-week topic trends
- MailerLite newsletter for opted-in users
- Landing-page lead capture

**Later**
- **MCP server.** Read your queue, opportunities and SEO data from Claude, Cursor or any MCP client, with a read-only tier on Free.
- **Agent skills.** A published `SKILL.md` so coding and research agents can use Vantage as a skill.
- Source discovery that suggests new communities, forums and newsletters for your niche
- More lanes (newsletters, podcasts, forums) and team workspaces
- Content calendar export to open-source schedulers (for example pendpost). Vantage still won't post for you.

## Principles

- **Never posts on your behalf.** Every reply and social post is yours to send.
- **Evidence over invention.** Drafts are grounded in sources you can see.
  Fixture data is labelled as mocked, and production fails closed rather than
  showing it as a real lead.
- **Spend is visible.** Paid provider calls are budgeted, metered per workspace,
  and AI tool calls that cost money ask first.

## Blog

Posts are Markdown files in [`content/blog/`](content/blog). Copy
`_template.md` to `<slug>.md`, run `pnpm blog:build`, and commit both the post
and the regenerated `lib/blog/posts.generated.ts`. Posts render to HTML at
build time (no filesystem or Markdown parser in the Worker) and ship with
canonical URLs, Open Graph tags, `BlogPosting`/`BreadcrumbList`/`FAQPage`
JSON-LD, and entries in `/sitemap.xml`, `/blog/rss.xml` and `/llms.txt`.

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

Production schedules `0 * * * *` (hourly, UTC) and staging `0 */3 * * *`
(every 3 hours). Digests go out at each workspace's chosen hour, and scans are
gated by the plan's scan interval. `worker-entry.mjs` adds the
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

See [AGENTS.md](AGENTS.md) for the standard loop, the HumanLayer workflow,
available MCP servers (agent-browser, Supermemory, Greptile), Cloudflare and
Neon operating rules, security invariants, migration conventions and how
Greptile reviews PRs.

## Ref orchestration

See `.warp/REF_ORCHESTRATOR_SETUP.md` for Warp Oz ↔ Ref Plans wiring.
