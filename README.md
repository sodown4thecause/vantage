# Vantage

**Vantage watches the public places developers talk, finds the few conversations worth joining, and hands you an evidence-backed draft before the moment passes. It never posts for you.**

Built for solo founders and small teams marketing AI developer tools: instead of checking Reddit, Hacker News, X, GitHub, Stack Overflow and newsletters every day, you get a short ranked queue (up to five opportunities a day), the posts that prove each one, and a reply draft you review and send yourself.

Runs on Cloudflare Workers (via OpenNext) with Neon Postgres.

---

## How it works

```
Onboarding profile ─► Sources ─► Collectors ─► Normalise + intent ladder ─► Opportunity Queue ─► Draft + review ─► You post
   (5 minutes)      (catalog)   (bounded,      (evidence kept, synthetic    (5-axis score,       (claim ledger,     (feedback trains
                                 budgeted)      evidence rejected)           max 5/day)            rules check)       per-workspace ranking)
```

1. **Profile.** A five-minute onboarding captures what you build and who it's for. Hacker News is provisioned automatically; RSS feeds are optional.
2. **Sources.** Install sources one at a time from a 30-entry community catalog (RSS, public Substack, HN, GitHub issues, Stack Overflow, Reddit, Firecrawl Alexandria, indexed LinkedIn discovery, X). Workspace source limits apply.
3. **Collection.** Free feeds and official GitHub / Stack Exchange APIs can run on the schedule. Paid providers are manual and opt-in. Every run writes a **coverage receipt** that says what was and wasn't collected (rate limits, partial windows, API deferrals).
4. **Opportunity Queue.** Documents are scored against your current profile on five axes (fit, intent, evidence, momentum, timing), shown as a score glyph. Only opportunities with real evidence are eligible.
5. **Drafting.** A draft is produced only after the system finds a contribution gap, builds a sentence-level claim ledger, and checks community rules and evidence. Editing resets approval. Hacker News and Stack Overflow get **research briefs** instead of drafts because their policies prohibit AI-written contributions.
6. **Outcomes.** Accept / dismiss / outcome events feed a north-star metric and a conservative per-workspace preference ranker.

**Never automated:** posting, commenting, DMs. Vantage recommends; a human acts.

## What's in `main`

| Area | What it does | Where |
|---|---|---|
| Onboarding & profile | Workspace creation, monitoring profile, provisioned HN source | `app/onboarding`, `lib/profile` |
| Community catalog | 30 curated developer-community sources, installed individually | `lib/communities/catalog.ts`, `docs/sources/community-collection.md` |
| Collectors | HN, RSS/Atom, Substack, GitHub, Stack Overflow, Reddit, X, Alexandria, LinkedIn discovery (Product Hunt / YouTube adapters are access-pending) | `lib/collectors`, `lib/reddit`, `lib/x`, `lib/firecrawl` |
| Opportunity Queue | Evidence-backed ranking, five-card daily limit, opportunity detail page | `app/queue`, `app/opportunities/[id]`, `lib/opportunities` |
| Drafting | Contribution-gap check, claim ledger, rules review, human handoff | `lib/drafting`, `app/api/drafts` |
| Learning & outcomes | Feedback events, north-star metric, bounded preference re-ranking | `lib/outcomes`, `lib/learning` |
| Cost ledger | Every provider call reserved and settled in a durable daily ledger; ambiguous accounting blocks further paid calls | `lib/costs`, `docs/costs.md` |
| Source switches | Global admin kill-switches per provider with audit log and paused-state UI | `app/admin/switches` |
| Plans & entitlements | Atomic metered limits, `/settings/plan` | `lib/plans`, `app/settings/plan` |
| Public route guard | Rate limit, Turnstile, daily dollar budget for unauthenticated routes | `lib/public` |
| Browser Run | Cloudflare Browser Run wrapper with cost recording and SSRF guard (never used for Reddit, LinkedIn, Facebook, Instagram or X) | `lib/browser`, `docs/browser-run.md` |
| Design system | "Survey sheet" tokens, Schibsted Grotesk + Newsreader, score glyph, shared `Shell` | `docs/design.md`, `components/` |

## In review (open PRs)

- **#49 Distribution engine** (S70, S72, S75): deterministic situation classifier (13 situations with freshness half-lives), a hand-verified launch-destination catalog with public `/launch` pages and sitemap, and suggested **plays** on each opportunity. Needs migration 0018 and `scripts/seed-destinations.ts`.
- **#47 Astro blog**: static SEO/AEO blog in `blog/` served from Workers static assets, with JSON-LD, RSS, sitemap and `llms.txt`. Requires `SITE_URL`.
- **#46 Cubic review config**: review rules for tenant isolation, migration safety, provider budgets and Worker secrets. Supersedes #33.
- Dependabot bumps: #41–#45.

## Providers and models

| Purpose | Provider | Notes |
|---|---|---|
| Reddit | TinyFish Search/Fetch → optional TinyFish Agent → Scavio | Paid, opt-in |
| X | Scavio | Grok significance analysis via AI Gateway (`X_GATEWAY_MODEL`, default `spacexai/grok-4.7`) |
| Web / datasets | Firecrawl (incl. Alexandria developer index and GitHub issues) | Credits priced via `FIRECRAWL_CREDIT_USD` |
| GitHub, Stack Overflow | Official public APIs | Free; respects rate-limit and backoff headers |
| HN, RSS, Substack | Public endpoints | Free; 512 KB response cap, opt-in 3 MB |
| Drafts | Vercel AI Gateway (`COMMENT_DRAFT_MODEL`, default `openai/gpt-6.1-sol`) | Optional Inco DeepSeek triage (`INCO_TRIAGE_ENABLED`) |

Paid collection is off unless `VANTAGE_PAID_PROVIDERS_ENABLED` is set and `VANTAGE_PAID_DAILY_BUDGET_USD` is configured. See `.env.example` for the full list.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript + Tailwind 4
- **Cloudflare Workers** via `@opennextjs/cloudflare`
- **Neon** Postgres + **Drizzle ORM**, **Neon Auth** (Managed Better Auth)
- **Vitest** test suite; GitHub Actions CI; Dependabot

## Getting started

```bash
pnpm install
cp .env.example .env.local
# Fill DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET (openssl rand -base64 32)
pnpm db:migrate
pnpm dev
```

`pnpm dev` runs on Node. Use `pnpm cf:preview` to exercise the real Worker runtime.

### Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Next dev server |
| `pnpm build` | Production Next build |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | ESLint, `tsc --noEmit`, Vitest |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle migrations and tooling |
| `pnpm cf:build` / `cf:preview` | Build (and preview) the Worker bundle |
| `pnpm deploy` | Build and deploy to Cloudflare |
| `pnpm cf:typegen` | Generate `cloudflare-env.d.ts` bindings |

## Deploying to Cloudflare Workers

Config lives in `wrangler.jsonc` and `open-next.config.ts`; `worker-entry.mjs` is the entrypoint and adds a `scheduled` handler.

```bash
wrangler login
wrangler secret put CRON_SECRET              # 32+ random bytes
wrangler secret put NEON_AUTH_COOKIE_SECRET  # 32+ chars
wrangler secret put DATABASE_URL             # Neon pooled connection string
pnpm deploy
```

- `NEON_AUTH_BASE_URL` must be a real, reachable Neon Auth URL. A placeholder builds green and then fails every login.
- **Migrations are manual.** `pnpm db:migrate` is not part of `pnpm deploy`. Apply to staging first, then run deliberately against production: `DATABASE_URL="postgresql://…" pnpm db:migrate`.
- **Cron** runs only in the `staging` environment (`0 */3 * * *` UTC). The scheduled handler calls the tick route through the `WORKER_SELF_REFERENCE` binding with `Authorization: Bearer ${CRON_SECRET}`.
- **Branch previews** use the `previews` block in `wrangler.jsonc`, whose build hook runs `pnpm run cf:build`. Previews copy no production bindings, don't run cron and never apply migrations. Give them isolated test secrets.
- **Bundle size**: CI fails if `.open-next/worker.js` exceeds 10 MB (Paid plan limit).
- **The build needs no secrets.** Neon Auth is constructed at request time; a CI job enforces this.

### Production secrets beyond the basics

`VANTAGE_ADMIN_USER_IDS`, `TURNSTILE_SECRET_KEY`, `VISITOR_SALT`, plus provider keys (`TINYFISH_API_KEY`, `SCAVIO_API_KEY`, `FIRECRAWL_API_KEY`, `AI_GATEWAY_API_KEY`, `INCO_API_KEY`). Leave `ENABLE_PUBLIC_PING` unset in production.

### Windows notes

`opennextjs-cloudflare build` calls `fs.symlinkSync`, which needs Developer Mode on Windows; otherwise build on Linux (WSL, Docker or CI). Don't work around it with `--node-linker=hoisted`, which copies every native-package variant and can exhaust the disk.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs two jobs on every PR:

- **Lint, typecheck, test, build**, including a migration-drift check
- **Cloudflare Worker bundle (no secrets)**, which packages the Worker and fails on secret dependence or oversize bundles

`deploy.yml` handles staging/production uploads (needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).

## Docs

| Doc | What's in it |
|---|---|
| `docs/VANTAGE-PRD.md` | Product strategy, ICP, JTBD |
| `docs/slices/` | Agent-ready delivery slices (S00–S61), human gates, review lenses, decisions |
| `docs/slices/DECISION-2026-10-07-login-first-usage-billing.md` | Current pricing direction: login-first, free basic scan, usage billing at cost + 20% |
| `docs/sources/` | Community collection and social-provider routing |
| `docs/costs.md` | Provider pricing and the cost ledger |
| `docs/design.md` | Design system |
| `docs/research/` | Provider verification and phase validation receipts |
| `docs/gtm/` | Switch-rescue outreach kit |

## Status

Pre-launch pilot. Staging runs on Cloudflare Workers; production cron, paid collection and billing (Stripe credit top-ups, S40–S45) are not yet enabled. See `docs/slices/README.md` for what's next.
