# Vantage build plan: vertical slices for parallel agents

**Source:** "Five moves that put Vantage ahead of the field" (Polar competitor review, 6 Oct 2026).
**Earlier plan (context, still valid):** `../superpowers/plans/2026-10-06-five-changes-on-cloudflare.md`.
**This folder supersedes its phase list.** Each `Sxx-*.md` file is one independently shippable vertical slice (database + library + API + UI + tests + docs) that one agent can finish in one pull request.

## 1. Current state (6 Oct 2026, end of day)

| Area | State |
|---|---|
| Cloudflare | Account `eb1a55a5…`. Worker `dontkillmyvibe` (production, exists), `vantage-staging` (deployed today at `https://vantage-staging.liam-wilson1990.workers.dev`). Cron triggers are **off** in both (`crons: []`). |
| Staging secrets | `CRON_SECRET`, `NEON_AUTH_COOKIE_SECRET`, `NEON_AUTH_BASE_URL` set. **`DATABASE_URL` is not set on the Worker yet** (human step, slice S00). |
| Neon | Project `vantage` (`super-river-31229994`). Branches: `main` (production) and `staging` (`br-quiet-pine-b7ukjr3b`, child of main). Staging has 12 migrations (0000 to 0011) and Neon Auth works there (test sign-up succeeded). `main` has 11 migrations (0011 not applied). |
| Code | Next.js 16 on OpenNext/Cloudflare, Drizzle over neon-http, Neon Auth. Phase 1 foundations committed on the PR branch (not yet on the default branch): `cost_event`, `provider_price`, `source_switch`, `shared_post`, `shared_sweep_run`, `lib/costs/ledger.ts`, `lib/sources/switch.ts`, switch check in `runCollector`. 135 tests pass. |
| Known gaps | No GitHub collector; scheduled scan only runs `hn`/`rss`/`substack`; `runCollector` blocks every non-free lane and any type outside hn/rss/substack in production (see "free pilot" guard, `lib/collectors/run.ts`); no Stripe/credits; no public pages; no MCP/CLI. |

## 2. How to work a slice (the agent contract)

1. **Pick a slice whose "Depends on" slices are merged** (or that has none). Check the status table in section 6.
2. **Branch:** `slice/Sxx-short-name` off the latest default branch. **One slice, one pull request**, opened as a draft. Do not bundle slices.
3. **Before every push run:** `pnpm lint && pnpm typecheck && pnpm test && node --test test/worker-entry.test.mjs`. Env for local runs: `DATABASE_URL=postgresql://user:pass@localhost:5432/vantage NEON_AUTH_BASE_URL=https://example.invalid/auth NEON_AUTH_COOKIE_SECRET=0123456789abcdef0123456789abcdef`. For slices that touch the Worker also run `pnpm cf:build`.
4. **Migrations:** change `lib/db/schema.ts`, run `pnpm db:generate`, commit the generated `drizzle/00NN_*.sql` plus `drizzle/meta`. Rules:
   - additive only (new tables/columns/indexes/enum values); never edit or delete a migration that exists on `main`;
   - the "Check migration drift" CI job fails if the schema and migrations disagree;
   - **if another slice merged a migration first, merge the default branch, delete your own unmerged migration files, and regenerate.** Never hand-resolve `drizzle/meta/_journal.json`;
   - applying migrations to a Neon branch is a human or S00/S01-owner step (`pnpm db:migrate`), never part of `pnpm deploy`.
5. **Tests:** put them in `test/`, Vitest, `@/` alias. Mock the database like `test/collector-runner.test.ts` (`vi.mock("@/lib/db/client", ...)`) and pure logic like `test/cost-ledger.test.ts`. No test may hit the network or a real database.
6. **Money and risk rules (non-negotiable):**
   - every outbound paid or metered call goes through `recordCost()` (`lib/costs/ledger.ts`);
   - every collector or provider call is behind a `source_switch` check (`getSourceSwitch(sourceKey)`), and paused sources return a labelled state, never a silent empty list;
   - never log or commit secrets, tokens, connection strings or cookies;
   - **Vantage never writes, posts, DMs or votes on a third-party platform.** Read-only access only;
   - public (unauthenticated) endpoints must use the guard from S06 and show only public data.
7. **Conventions:** route handlers follow `app/api/opportunities/run/route.ts` (validate input, `authorizeWorkspace(workspaceId)`, never return raw error text, see `test/error-disclosure-contract.test.ts`). Repositories live in `lib/<area>/repository.ts`. Collectors implement `Collector` from `lib/collectors/types.ts`. Match nearby comment density and naming.
8. **Adding a new source type** touches five places; do all of them: `sourceTypeEnum` + `sourcePlatformValues` in `lib/db/schema.ts` (and an `ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS '<x>'` migration, see `drizzle/0003_source_type_x.sql`), the `SourceType` union in `lib/collectors/types.ts`, `lib/collectors/registry.ts`, the type allow-lists in `lib/cron/scan.ts` and the production guard in `lib/collectors/run.ts`, and the add-source UI (`app/settings/sources/page.tsx`, `app/source-controls.tsx`, `lib/sources/actions.ts`).
9. **Review:** every PR goes through the specialized review in [`REVIEW.md`](REVIEW.md) by someone other than the author before merge.
10. **Definition of done (every slice):** acceptance criteria all met and demonstrated in the PR description; tests added; lint/typecheck/tests green; migration (if any) generated; docs in the slice file updated (check the boxes, add "Learned" notes); no secrets; PR left as draft with a checklist of human gates still open.
11. **Hot-spot files (expect merge conflicts, keep edits small and additive):** `lib/db/schema.ts`, `drizzle/meta/_journal.json`, `wrangler.jsonc`, `lib/collectors/registry.ts`, `lib/collectors/types.ts`, `lib/cron/scan.ts`, `app/page.tsx`, `app/layout.tsx`.

## 3. Human gates (agents must stop and hand these to the owner)

| Gate | Needed by | What |
|---|---|---|
| H1 | S00 | `DATABASE_URL` for staging (pooled string of Neon branch `staging`) set as a Worker secret |
| H2 | S01 | Production `DATABASE_URL`, `NEON_AUTH_*`, apply migrations to Neon `main`, custom hostname |
| H3 | S02 | Cloudflare token with Queues: Edit, Workflows, Browser Rendering: Edit, R2 (current token has Workers only) |
| H4 | S10 | `TINYFISH_API_KEY` in the environment |
| H5 | S13, S14 | `GITHUB_TOKEN` (read-only public data) |
| H6 | S42 | `XAI_API_KEY`, `SCRAPECREATORS_API_KEY`, `SCAVIO_API_KEY` |
| H7 | S40, S41 | Stripe (Australian account) keys, products and webhook endpoint |
| H8 | S06 | Cloudflare Turnstile site/secret keys |
| H9 | S60, S61 | Outreach to Switch Rescue users; the Show HN post is **written by the owner** (HN bans AI-written text) |
| H10 | all | Owner decisions flagged "Decision" inside slices |

Security note: two Cloudflare tokens were pasted into chat on 6 Oct. The owner must delete/roll them. Agents must read credentials from environment variables only, never from chat, and never write them to disk.

## 4. Architecture target (what the slices build toward)

```
 Visitor / user ─► Worker (OpenNext)  ─► Neon Postgres (source of truth, neon-http)
   pages, /api/*     │   │   │   │          Neon Auth (workspaces, sessions)
   MCP (/api/mcp)    │   │   │   └─► Browser Run  (BROWSER binding, quickAction only)
                     │   │   └─────► R2 (OG images, exports)
 Cron 3h ─► scheduled() ─► Queue sweep-jobs ─► consumer ─► providers (TinyFish, GitHub, HN, ...)
                     └──► Workflow radar-scan (durable, ~60s) ─► shared_post + free sources
```

Rules: Neon is the only source of truth; one deployed bundle (reuse the `WORKER_SELF_REFERENCE` pattern in `worker-entry.mjs`); every paid call writes a `cost_event`; every source has a switch.

### Browser Run (Cloudflare Browser Rendering) usage rules
Use Quick Actions (`env.BROWSER.quickAction("markdown" | "content" | "json" | "screenshot" | "links" | "crawl", {...})`) for: reading a product/docs site, competitor page watching, rules-page re-checks, OG screenshots. Needs `compatibility_date` >= 2026-03-24 (current is 2026-10-05) and `"remote": true` for local dev. Cost: Workers Paid includes 10 browser-hours a month, then $0.09/hour; the `X-Browser-Ms-Used` response header gives per-call time to record. **Never use it for Reddit, LinkedIn, Facebook or Instagram** (bot-identifying crawler, robots.txt, platform terms). Never fetch non-public URLs (use `isPublicHttpUrl` from `lib/http/public-fetch.ts`).

### Cost facts used across slices (from the competitor review, 6 Oct 2026; re-check before quoting publicly)
HN/GitHub/Stack Overflow/RSS/YouTube/Product Hunt: $0 (quotas). Reddit keyword search via TinyFish Search+Fetch: $0. Reddit shared sweep (TinyFish Agent): about $23/month for all users. Reddit deep search: about $0.19/run. X scan of 25 posts via Grok x_search: about $0.15 (82% is the per-post fee). LinkedIn/Instagram/Facebook via ScrapeCreators: $0.0019/request. AI scoring: about $0.0005/post. Stripe international card: 3.5% + A$0.30. Plans: Free $0 (Reddit included), Pro $5/month or $48/year, credits from $5 = provider cost + 15% (1 credit = 1 cent).

## 5. Waves and dependency graph

```
Wave 0 (human-gated)   S00 ─► S01        S02
Wave 1 (parallel)      S03  S04  S05  S06  S07  S10
Wave 2                 S11(S02,S03,S04)  S13(S03,S04)  S14(S03,S04)  S20  S30  S40  S43(S03)
Wave 3                 S12(S10,S11)  S15(S20)  S21(S06,S07,S11,S13,S14,S20)  S31(S30,S20)  S41(S03,S40)  S44(S03)  S52(S20)
Wave 4                 S16(S11)  S22(S21)  S23(S21)  S32(S31)  S42(S41,S04)  S45(S05,S40,S41)  S46(S23,S40)  S50(S21)  S51(S50,S52)
Wave 5                 S33(S31,S32)  S60  S61
```

## 6. Slice index and status

Size: S = under a day, M = 1 to 3 days, L = 3 to 5 days of agent work. "Idea" refers to the five moves (1 Reddit, 2 Radar, 3 Reply Briefs, 4 Ship as skill, 5 Cheapest in public).

| ID | Slice | Idea | Size | Depends on | Human gate | Status |
|---|---|---|---|---|---|---|
| [S00](S00-staging-live.md) | Staging live end to end | base | S | none | H1 | [ ] |
| [S01](S01-production-and-rollback.md) | Production promotion, rollback, CI deploy | base | M | S00 | H2 | [ ] |
| [S02](S02-cloudflare-resources.md) | Queues, R2, rate-limit, Browser, Workflow bindings | base | S | S00 | H3 | [ ] |
| [S03](S03-cost-ledger-wiring.md) | Wire cost ledger into every provider + rollups | 5 | M | none | none | [x] |
| [S04](S04-source-switch-admin.md) | Source switch admin + paused-state UI | 1 | S | none | none | [ ] |
| [S05](S05-plans-and-entitlements.md) | Plans and entitlement enforcement | 5 | M | none | none | [ ] |
| [S06](S06-public-route-guard.md) | Public endpoint guard (rate limit, Turnstile, budget) | 2 | M | none | H8 | [ ] |
| [S07](S07-browser-run-helper.md) | Browser Run helper with cost + SSRF guard | 2 | S | none | none | [ ] |
| [S10](S10-tinyfish-reddit-spike.md) | TinyFish-on-Reddit spike | 1 | S | none | H4 | [ ] |
| [S11](S11-reddit-shared-sweep.md) | Reddit provider chain + shared sweep | 1 | L | S02,S03,S04 | none | [ ] |
| [S12](S12-reddit-search-and-deep.md) | Reddit keyword search + deep search quota | 1 | M | S10,S11 | none | [ ] |
| [S13](S13-github-collector.md) | GitHub issues/discussions + competitor repo watch | 1,2 | M | S03,S04 | H5 | [ ] |
| [S14](S14-developer-source-collectors.md) | Stack Overflow, DEV.to, Lobsters, Bluesky, Discourse | 1 | L | S03,S04 | none | [ ] |
| [S15](S15-keyword-importer.md) | GummySearch / F5Bot / Syften keyword importer | 1 | M | S20 | none | [ ] |
| [S16](S16-access-tracker-and-alternatives.md) | Platform Access Tracker + alternative pages | 1 | M | S11 | none | [ ] |
| [S20](S20-monitor-pack-model.md) | Monitor Pack model + auto-draft | 2,4 | M | none | none | [ ] |
| [S21](S21-radar-scan-workflow.md) | Radar scan workflow, API and cache | 2 | L | S06,S07,S11,S13,S14,S20 | none | [ ] |
| [S22](S22-radar-ui-and-share-pages.md) | Radar hero, results, share page, OG image, badge | 2 | M | S21 | none | [ ] |
| [S23](S23-radar-to-signup.md) | Radar to account handoff | 2 | S | S21 | none | [ ] |
| [S30](S30-community-rules-index.md) | Community Rules table + public index | 3 | M | none | none | [ ] |
| [S31](S31-reply-briefs.md) | Reply Brief generation and UI (replaces drafts) | 3 | L | S20,S30 | none | [ ] |
| [S32](S32-voice-check-and-ledger.md) | Voice-check editor + contribution ledger | 3 | M | S31 | none | [ ] |
| [S33](S33-never-posts-guard.md) | "Never writes or posts" guard test + brand copy | 3 | S | S31,S32 | none | [ ] |
| [S40](S40-stripe-pro.md) | Stripe Pro subscription, portal, webhooks | 5 | L | none | H7 | [ ] |
| [S41](S41-credits-ledger.md) | Credits ledger, top-ups, atomic debit | 5 | L | S03,S40 | H7 | [ ] |
| [S42](S42-paid-sources-on-credits.md) | X (Grok) and ScrapeCreators sources on credits | 5 | L | S04,S41 | H6 | [ ] |
| [S43](S43-pricing-page-calculator.md) | Pricing page + calculator | 5 | M | S03 | none | [ ] |
| [S44](S44-open-ledger-page.md) | Open Ledger public page + rollups | 5 | M | S03 | none | [ ] |
| [S45](S45-free-plan-guardrails.md) | Free-plan budget cap, idle pause, renewal reminders | 5 | M | S05,S40,S41 | none | [ ] |
| [S46](S46-attribution.md) | Signup attribution and cost per signup | 5 | S | S23,S40 | none | [ ] |
| [S50](S50-mcp-server.md) | MCP server on the Worker | 4 | L | S21 | none | [ ] |
| [S51](S51-cli-and-skill-package.md) | `npx vantage init`, plugin and skill files | 4 | L | S50,S52 | none | [ ] |
| [S52](S52-monitor-pack-library.md) | Public Monitor Pack library + CI validation | 4 | M | S20 | none | [ ] |
| [S60](S60-switch-rescue-kit.md) | Switch Rescue manual test kit | gtm | S | none | H9 | [ ] |
| [S61](S61-launch-checklist.md) | Launch checklist and venue-rules check | gtm | S | S16,S21,S30 | H9 | [ ] |

## 7. Decisions already made (do not re-litigate inside a slice)

- Reddit stays in the free plan through TinyFish, with a fallback chain and its own switch.
- X runs through Grok `x_search`; LinkedIn, Facebook and Instagram through ScrapeCreators first, Scavio as fallback. All are credit-metered, never bundled.
- Price: Free $0, Pro $5/month ($48/year), credits at provider cost + 15%. If fewer than 1 in 20 free users pay after 90 days, raise Pro to $7 for new customers only.
- Vantage never writes or posts for the user. HN and any venue that bans AI text gets a brief only, never a draft. r/SaaS is not a launch venue.
- Neon is the system of record. No Hyperdrive unless interactive transactions become necessary.

## 8. Calendar anchors (from the review)

31 Oct: Reddit stops accepting new public API requests (have S10, S11, S43, S40/S41 core ready). 13 Nov: Reddit RSS ends (S16 tracker live). 30 Nov: GummySearch lifetime access ends (S21/S22 homepage preview, S15 importer). Early Dec: launch (S50/S51/S52, S61). 12 Jan: unregistered Reddit apps lose access (S31/S30 shipped). March 2027: Reddit public API closes.
