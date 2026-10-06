# Five Changes on Cloudflare + Neon: Build Plan

**Source:** "Five moves that put Vantage ahead of the field" (Polar competitor review, 6 Oct 2026).
**Builds on:** `2026-10-06-cloudflare-launch.md` (Tasks 6–7 there are still ACCESS_PENDING; this plan treats them as Phase 0).
**Superseded for execution by `docs/slices/README.md`** (35 vertical slices an agent can pick up one at a time). This file remains the narrative rationale.
**Status date:** 6 Oct 2026. Facts about the live accounts were read from the Cloudflare and Neon APIs today.

## 0. Where things stand

| Item | Finding |
|---|---|
| Cloudflare | Worker `dontkillmyvibe` exists (last modified today). **No `vantage-staging` Worker yet.** No KV, R2 or Hyperdrive resources were checked beyond the Worker list; assume none. |
| Neon | Project `vantage` (`super-river-31229994`, aws-us-east-1, PG 18). One branch, `main`. **All 11 migrations (0000–0010) are applied.** Zero workspaces, sources, documents or opportunities: nobody has signed up. Three other Neon projects exist and are unrelated; leave them alone. |
| Code | OpenNext 1.20.8 + Wrangler 4.147 + Drizzle/neon-http + Neon Auth. `wrangler.jsonc` has `crons: []` on purpose (enable after staging passes). |
| Scan gap | `lib/cron/scan.ts` only runs `hn`, `rss`, `substack` collectors. Reddit, X, Product Hunt and YouTube are not in the scheduled path. |
| Missing from the code | No GitHub collector, no cost ledger, no Stripe, no credits, no shared (cross-workspace) data, no public pages, no MCP/skill package. |

**Decision for Browser Run (your question).** Use it, but not where the PDF's Reddit idea would tempt you. Details in §2.

## 1. Target architecture

```
                         ┌────────────── Cloudflare ──────────────┐
 Visitor / user ───────► │ Worker "vantage" (OpenNext, Next.js)   │
                         │  /  /radar/[owner]/[repo]  /pricing    │
                         │  /ledger  /access-tracker  /rules      │
                         │  /api/radar  /api/mcp  /api/stripe/*   │
                         └──┬────────┬─────────┬─────────┬────────┘
              Cron (3h) ────┘        │         │         │
              scheduled() ──► Queue  │         │         └─► Browser Run (binding BROWSER)
                  │      "sweep-jobs"│         │              quickAction: markdown / json /
                  ▼                  ▼         ▼              screenshot / crawl
          Queue consumer       Workflows    R2 bucket
          (1 job = 1 subreddit  "radar-scan" (OG images, cache)
           or 1 source batch)   (durable, ~60s)
                  │                  │
                  └──────┬───────────┘
                         ▼
                 Neon Postgres (neon-http, Drizzle)  ◄── source of truth
                 Neon Auth (workspaces / sessions)
```

Principles:

1. **Neon is the only source of truth.** KV/R2/Queues hold transient or large blobs only.
2. **One bundle.** Keep the existing `WORKER_SELF_REFERENCE` pattern. Queue consumers and Workflows call the same route handlers rather than importing app code a second time (see `worker-entry.mjs` header).
3. **Every outbound paid call writes a `cost_event` row first.** This one table feeds the free-plan budget cap, the pricing calculator, the Open Ledger page and credit billing. Build it before Ideas 1 and 5 need it.
4. **Every source has a kill switch** (`source_switch`) and a visible paused state. The PDF accepts Reddit/LinkedIn/Meta terms risk on that condition.
5. **Cloudflare plan:** upgrade to **Workers Paid ($5/mo)** before launch. Free is 10 ms CPU per request and 10 browser-minutes a day, which the OpenNext bundle and Radar will not live within.

### Resources to create

| Resource | Name | Why |
|---|---|---|
| Workers | `dontkillmyvibe` (prod), `vantage-staging` | existing split in `wrangler.jsonc` |
| Queue | `vantage-sweep-jobs` (+ DLQ `vantage-sweep-dlq`) | fan-out of the ~100-subreddit sweep and source batches |
| Workflow | `radar-scan` | durable multi-step public scan |
| R2 bucket | `vantage-assets` | OG screenshots, pack exports; also usable as OpenNext incremental cache later |
| Rate Limiting binding | `RADAR_LIMITER` | per-visitor limit on the no-signup scan |
| Browser binding | `BROWSER` | see §2 |
| Neon branches | `main` (prod), `staging` (child of main) | separate `DATABASE_URL`/auth per Worker env |
| Secrets (each env) | `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `CRON_SECRET`, `TINYFISH_API_KEY`, `SCAVIO_API_KEY`, `XAI_API_KEY`, `SCRAPECREATORS_API_KEY`, `GITHUB_TOKEN` (read-only, public data), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `AI_GATEWAY_API_KEY` | |

Skip Hyperdrive: `@neondatabase/serverless` over HTTP already works from Workers, and Drizzle neon-http is in use. Revisit only if you need interactive transactions (credit debits are the one place that might; see §7).

## 2. Browser Run: where it helps and where it doesn't

Browser Run is Cloudflare Browser Rendering (renamed April 2026). Two modes: **Quick Actions** (one call: `/markdown`, `/content`, `/json`, `/screenshot`, `/links`, `/scrape`, `/snapshot`, `/crawl`) and **Browser Sessions** (full Puppeteer/Playwright). From a Worker: add `"browser": { "binding": "BROWSER" }` and call `env.BROWSER.quickAction("markdown", { url })`. Needs compatibility date ≥ 2026-03-24 (yours is 2026-10-05) and `remote: true` for local `wrangler dev`. In OpenNext, read it via `getCloudflareContext().env.BROWSER`.

**Cost:** Workers Paid includes 10 browser-hours a month, then $0.09/hour for Quick Actions. Each response carries `X-Browser-Ms-Used`; record it in `cost_event`. At typical page loads (a few seconds), 10 hours is thousands of pages. Free plan caps at 10 minutes a day, so production needs Paid.

**Good uses**

| Use | Idea | Action |
|---|---|---|
| Read a repo's docs site / landing page when the input isn't a GitHub URL or the README links out | 2 | `/markdown` (JS-rendered pages work) |
| Pull "facts you can use" from the user's own docs with links for the claim checker | 3 | `/markdown`, then existing claim-check code |
| Auto-draft Monitor Packs: crawl the product site + competitor sites for names/positioning | 2, 4 | `/crawl` (honours robots.txt, `render:false` for static sites) |
| Competitor change watcher (pricing/changelog pages) — the PRD's deferred `competitor_change` | 1, 5 | `/markdown` on a schedule, hash, diff |
| Verify and date-stamp the Platform Access Tracker and Community Rules Index (read each community's rules page, compare to stored text, flag drift) | 1, 3 | `/markdown` + `/json` extraction |
| Open Graph image for every `/radar/owner/repo` share page | 2 | `/screenshot` of an HTML card, store in R2 |
| Pricing page proof: screenshot competitor pricing for the dated log | 5 | `/screenshot` |

**Do not use it for Reddit.** `/crawl` self-identifies as a bot, honours `robots.txt` and cannot bypass bot detection; Reddit disallows this, and driving a browser at it is exactly the "scraping without an authorized agreement" that Rule 8 names. Keep Reddit on TinyFish (decided in the PDF) with Scavio as fallback. Same for LinkedIn/Facebook/Instagram: ScrapeCreators, not a browser.

**Not needed for the free sources.** HN (Algolia), GitHub, Stack Overflow, DEV.to, Lobsters, Bluesky and Discourse have APIs or feeds. A browser there is slower and costs money.

## 3. Phase 0 — Finish the Cloudflare baseline (this week)

Do this before any feature work. It is Tasks 1, 6, 7 of the existing launch plan, trimmed.

1. **Upgrade Cloudflare to Workers Paid.** (Account action: you.)
2. **Create Neon branch `staging`** from `main`. Put its pooled `DATABASE_URL` in the `vantage-staging` Worker secrets and `main`'s in `dontkillmyvibe`. Migrations already exist on `main`; the `staging` branch inherits them.
3. **Neon Auth:** enable per branch, add the Worker URLs as trusted domains (staging, prod, and any custom hostname). Without this, login silently fails (the README warns about placeholder `NEON_AUTH_BASE_URL`).
4. **Set secrets** on both Workers (`wrangler secret put … --env staging|production`). Generate `CRON_SECRET` and `NEON_AUTH_COOKIE_SECRET` with `openssl rand -base64 32`.
5. **Deploy staging**, sign up, onboard, add an HN source, trigger `/api/cron/tick` manually with the bearer secret. Confirm a document and an opportunity land in Neon.
6. **Enable the 3-hour cron on staging only** (`"crons": ["0 */3 * * *"]` under `env.staging`). Watch Workers observability for 24h.
7. **Promote to production**, demonstrate rollback (`wrangler rollback`), then enable cron on prod.
8. **Fix the scan gap:** extend the `inArray(source.type, …)` list in `lib/cron/scan.ts` as each new collector becomes safe, rather than in one jump.
9. **CI:** `workers-build` already runs `wrangler deploy --dry-run --env staging`. Only an automated staging *deploy* job is missing, and it can wait until a Cloudflare API token is stored in CircleCI.

**Progress (6 Oct):** baseline verified on Linux (lint, typecheck, 121 tests + 5 worker-entry tests, `pnpm cf:build` all pass). Neon branch `staging` (`br-quiet-pine-b7ukjr3b`) created from `main`, with all 11 migrations and the `neon_auth` schema present. Blocked on step 1/4/5: no Cloudflare credentials in this environment (`wrangler whoami` = not authenticated).

Exit gate: one real signup on staging produces real documents and ranked opportunities from cron, with no secrets in the build.

## 4. Phase 1 — Foundations used by all five ideas (by ~20 Oct)

### 4a. Cost ledger (`cost_event`)

```
cost_event(id, ts, workspace_id nullable, source_key, provider, action,
           units, unit_cost_usd numeric(12,6), cost_usd numeric(12,6),
           billable_to enum('platform','workspace_credits'), request_ref, ok bool)
provider_price(provider, action, unit_cost_usd, effective_from)   -- editable prices, no deploys
```

- Wrap every provider client (`lib/tinyfish/*`, `lib/scavio/client.ts`, `lib/x/client.ts`, new ScrapeCreators client, Browser Run helper) in one `recordCost()` call.
- Failed runs record `cost_usd = 0` where the provider doesn't charge (TinyFish failed runs are free per the PDF).
- This is PRD "cost-meter data from M3" that Idea 5 depends on.

### 4b. Source switches

```
source_switch(source_key pk, enabled bool, state enum('on','paused','blocked'),
              reason text, changed_at, changed_by)
```

Checked at the top of every collector run. A paused source returns a labelled "Reddit paused" result, never a silent empty list. Admin toggle at `/admin/switches` (guard with an allow-list of your user ID).

### 4c. Shared (workspace-independent) data

Reddit sweep results are the same for everyone, so they must not be workspace-scoped.

```
shared_post(id, platform, external_id unique-with-platform, url, author, community,
            title, body, posted_at, fetched_at, content_hash, provider)
shared_sweep_run(id, platform, started_at, finished_at, communities_ok, communities_failed, cost_usd, state)
```

A workspace's opportunities are created by matching `shared_post` rows against that workspace's keywords, not by re-fetching.

### 4d. Plan and entitlements

Add `workspace.plan` enum (`free`, `pro`), `workspace_entitlement` limits table (projects 1/3, keywords 5/25, leads/day 20/100, deep searches/month 0/5), enforced in the repository layer so every route gets the same check. Do not build credits or Stripe yet (Phase 5).

### 4e. Public-route hardening

Public pages and the Radar endpoint are the first unauthenticated, cost-bearing surface. Add the Rate Limiting binding, Turnstile on the scan form, a daily dollar budget row in Neon (`budget_day(date, spent_usd, cap_usd)`) and a hard stop when the cap is hit.

## 5. Phase 2 — Idea 1: Reddit free and unbreakable (by 31 Oct)

**Spike first (half a day, before building):** does TinyFish Fetch return Reddit page content? The PDF flags this as untested. Results decide whether the shared sweep costs ~$0 or ~$23/month.

Build:

1. `lib/collectors/reddit/` provider chain: **Fetch → Agent → Scavio → last cached sweep → "Reddit paused"**. Each step checks `source_switch` and a per-step cost cap; each result tags `metadata.provider`.
2. **Shared sweep.** Cron every 3h enqueues one job per subreddit (~100, list in `reddit_community` table seeded from a CSV). Consumer fetches, writes `shared_post`, records `cost_event`. Queue batch size 10, `max_retries` 2, DLQ. Replaces the per-workspace Reddit call in `lib/collectors/reddit.ts`.
3. **Keyword search layer:** per-workspace keyword search across all of Reddit via TinyFish Search+Fetch (free per PDF), results into `shared_post` and matched to the workspace.
4. **Deep search layer:** TinyFish Agent for the signup report and Pro (5/month; quota in entitlements).
5. **New developer sources**, one collector each behind the existing `Collector` interface and registry (the PDF estimates 2–4 days each): GitHub issues + discussions (REST, token), Stack Overflow (API), DEV.to (API), Lobsters (JSON feed), Bluesky (public search API), Discourse (public JSON). Start with GitHub, since Idea 2 needs it.
6. **Competitor GitHub watching:** a pack setting listing competitor repos; collector scans their issues for "still maintained", "alternative", "license" patterns.
7. **Keyword importer:** paste GummySearch / F5Bot / Syften export (CSV or plain list) → parser → draft Monitor Pack. Test with real exports from the Switch Rescue conversations.
8. **Website:** Platform Access Tracker (`/access-tracker`, data in `access_log` table with dated entries; entries seeded from the PDF dates), `/gummysearch-alternative`, `/f5bot-alternative` (price in headline), "Reddit RSS ends 13 Nov: what still works". Ship the tracker by **13 Nov**.

Measure: Reddit uptime, cost per Reddit lead, useful leads/day with Reddit switched off (chaos test: flip the switch in staging and confirm the UI shows the paused state and other sources keep running).

## 6. Phase 3 — Idea 2: Live Radar (by 30 Nov)

**Input:** GitHub repo URL (or any URL). **Output:** top 5 public threads with intent level, the sentence that proves intent, reply-window clock; shareable at `/radar/[owner]/[repo]`. No account, no Reddit live search, no X.

**Flow (Workflow `radar-scan`, each as a `step.do` so it retries independently):**

1. Normalize input, check 24h cache in `radar_scan` (key = `owner/repo`). Cache hit returns instantly.
2. Fetch repo metadata, README, topics, `package.json`/`pyproject.toml` via GitHub API. If the URL isn't GitHub, or the README points to a docs site, use Browser Run `/markdown`.
3. Draft a Monitor Pack with the LLM (queries, negative keywords, competitor names, communities). Use AI Gateway; cap tokens.
4. Fan out to free sources in parallel (HN Algolia, GitHub issues, Stack Overflow, DEV.to, Lobsters, Bluesky, plus YouTube/Substack/RSS/Product Hunt where already built), **plus** match against `shared_post` for Reddit. Hard per-source timeout 8s.
5. Score with the existing intent ladder and `lib/opportunities/features.ts`; keep top 5; store the highlighted sentence.
6. Write `radar_scan` + `radar_thread` rows; render OG image via Browser Run `/screenshot` to R2.

```
radar_scan(id, repo_key unique, input_url, pack jsonb, state, created_at, expires_at, visitor_hash, cost_usd)
radar_thread(id, scan_id, source, url, title, excerpt, intent_level, evidence_sentence, posted_at, reply_window_ends)
```

**Public-safety rules:** show only public threads; no author handles beyond what's in the URL; `noindex` until quality is checked; per-visitor limit 5 scans/day; global dollar cap from §4e; honest label when a source timed out.

**Website:** hero is the input box; "Or run it in your agent: `npx vantage init`" under it; optional README badge (`/badge/[owner]/[repo].svg`) linking to the radar page; "Keep watching every 3 hours" saves the pack and creates the account via Neon Auth (this reuses the existing onboarding with the pack pre-filled).

Measure: scan completion rate, scans → signups.

## 7. Phase 4 — Idea 3: Reply Briefs (by January, before Reddit's 12 Jan cutoff)

**Rule: Vantage never writes or posts the user's comment.** This changes the PRD's drafting feature, so retire the draft generator rather than hide it.

1. **Replace `lib/drafting/generate.ts`** output with a `reply_brief` record: the ask in one line, what they've tried, 2–3 facts from the user's docs with links (reuse the claim-checker retrieval), one honest limitation, venue rules, angle, don't-list, disclosure line. Migration: keep old `opportunity_draft` rows readable, stop creating new ones.
2. **Venue rules table** `community_rule(platform, community, allows_promotion, allows_links, bans_ai_text, source_url, last_checked, notes)`. Brief generation looks this up; for venues with `bans_ai_text` (HN), the brief has **no draft section at all**.
3. **Plain editor with voice check:** flags stock AI phrasing (phrase list in repo, versioned) and lines repeating the user's last 10 comments (store hashes in `contribution_ledger`). No rewrite button.
4. **Contribution ledger:** track helpful vs promotional posts per community (PRD #8); warn when promotional share passes a threshold.
5. **Community Rules Index** (public, indexable): `/rules`, `/rules/[platform]/[community]`. Seed the top 100 dev communities by hand, with `last_checked`. Use Browser Run `/markdown` + `/json` to re-read each rules page weekly and flag changes for **your review** (never auto-publish a rules change).
6. Skip r/SaaS entirely, per the PDF.

Needs your attention: the brand promise ("never writes or posts for you") has to be literally true in code. Add a test that fails if any route or collector can write to a third-party platform.

## 8. Phase 5 — Idea 5: Cheapest, in public (build the money path by 31 Oct; ledger by January)

Plan: Free $0 (Reddit included), Pro $5/mo or $48/yr, credits from $5 at provider cost + 15%.

1. **Stripe** (Australian account): Checkout for Pro (monthly/yearly) and credit top-ups ($5/10/25), webhooks `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated|deleted` → Neon. Customer portal link for one-click cancel. Renewal reminder email 7 days before (Cloudflare Email Service or Resend).
2. **Credits:** `credit_txn(id, workspace_id, delta_credits, reason, cost_event_id, stripe_ref, ts)` — append-only; balance is a sum. 1 credit = 1¢. A debit is one SQL statement using `INSERT … SELECT … WHERE balance >= cost` so it's atomic over neon-http (no interactive transaction needed). Charge = `ceil(provider_cost × 1.15 × 100)` credits, minimum 1.
3. **Paid-source actions** (X scan ~17 credits, LinkedIn/Instagram/Facebook 0.22, extra Reddit deep search ~22) check balance first, then run, then reconcile actual cost.
4. **X post budget:** set `from_date` to yesterday, keyword mode, monthly post cap per user; bill from `x_posts_fetched`.
5. **Pricing page:** calculator (pick sources + frequency → provider cost + 15%) reading `provider_price`, plus "What we don't cover".
6. **Open Ledger** (`/ledger`): materialised daily rollup of `cost_event` (cost per source, median cost per useful lead, margin, uptime). Show nothing until you have real data; label estimates as estimates (PRD rule against made-up numbers).
7. **Free-plan guardrails from the PDF:** daily dollar budget on the signup report (not a flat 5 runs), pause free projects unopened for 14 days.
8. **Attribution** (PRD #14): store `signup_source` and radar scan ID on the workspace, so cost per signup is computable.

Trigger to review pricing: <1 in 20 free users paying after 90 days → move Pro to $7 for new customers.

## 9. Phase 6 — Idea 4: Ship as a skill (December)

1. **MCP server** on the same Worker at `/api/mcp` (Streamable HTTP; use Cloudflare's `agents`/MCP helpers). Tools: `radar_scan(repo)`, `find_threads(pack)`, `reply_brief(thread_url)`, `list_packs`. Anonymous tier uses the Radar limits; signed-in uses the workspace.
2. **`npx vantage init` package** (`packages/cli/`, published to npm): writes the skill/MCP config for Claude Code, Cursor, Codex, Hermes and OpenClaw. Local mode runs the free sources from the user's machine with no server.
3. **Claude Code plugin + `SKILL.md`** so "find 5 threads I should answer today" returns Reply Briefs.
4. **Monitor Pack library:** `packs/*.yaml` in the repo (schema-validated in CI), rendered as `/packs/[slug]` pages with recent public threads (from Radar-style scans), fork button, contributors from git. PRs add packs. Each pack is an SEO landing page ("find people looking for a vector database").
5. Move to a pnpm workspace (`pnpm-workspace.yaml` already exists) when the CLI lands.

## 10. Calendar

| By | Ship |
|---|---|
| **10 Oct** | Phase 0 complete: staging + prod live, cron on, Workers Paid |
| **20 Oct** | Phase 1: `cost_event`, `source_switch`, `shared_post`, entitlements, public rate limits |
| **31 Oct** | Reddit chain + shared sweep (after the TinyFish spike), GitHub collector, Grok X scan with post cap, ScrapeCreators, Stripe Pro + credits, `/gummysearch-alternative`, `/f5bot-alternative` |
| **1–14 Nov** | Run the Switch Rescue manual test (GummySearch, F5Bot, Reddit-RSS users). Platform Access Tracker live by **13 Nov** |
| **30 Nov** | Radar on the homepage, keyword importer |
| **Early Dec** | Show HN (written by you), MCP/skill package, first Monitor Packs, Product Hunt, r/selfhosted, r/opensource, DEV.to. Skip r/SaaS |
| **January (before 12 Jan)** | Reply Briefs, Rules Index, proof page, live Open Ledger, one Partner Recipe |

## 11. Things only you can do

- Workers Paid upgrade; Cloudflare API token if you want me to deploy from this environment (currently I can read the account but not deploy).
- API keys: TinyFish, xAI, ScrapeCreators, Scavio, GitHub token, Stripe, AI gateway.
- Trusted-domain and callback setup for Neon Auth if you add a custom hostname.
- Run the Switch Rescue outreach by hand, and write the Show HN post yourself.
- Read Reddit's Rule 8 and decide how much of the free plan you're willing to rest on it; the plan keeps it switchable for that reason.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Reddit blocks TinyFish or objects under Rule 8 | `source_switch`, fallback chain, labelled paused state, other sources keep working |
| TinyFish Fetch doesn't return Reddit pages | Spike first; fall back to Agent (~$0.19/run) or Scavio (~$0.004) and recompute the free-plan budget |
| Radar scan abused (cost) | Rate Limiting binding, Turnstile, global daily dollar cap, 24h cache, free sources only |
| Worker bundle approaches 10 MB | CI already checks; keep MCP and Stripe code lazy-imported |
| neon-http has no interactive transactions | single-statement atomic debits; `db.batch()` for multi-write |
| Product Hunt needs written permission for commercial use | keep it off the public Radar until you have it |
| Competitor facts go stale | re-check before quoting any price or feature publicly (PDF's own caveat) |
| LinkedIn/Meta terms restrict scraping | credits-only, own switches, never bundled |
