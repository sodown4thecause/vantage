# VANTAGE Cloudflare Launch Implementation Plan and Completion Audit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run VANTAGE on Cloudflare with real source collection, an automatically refreshed Opportunity Queue, working onboarding/authentication, bounded costs, and a demonstrated rollback.

**Architecture:** Retain the existing Next.js application, use the OpenNext integration already proposed in PR #30, and keep Neon HTTP PostgreSQL/Drizzle and Neon Auth. Start with one application Worker and its scheduled handler; introduce Queues only if measured workloads cannot meet the bounded scan budget. Staging and production have separate Workers, database/auth endpoints, secrets, and self bindings.

**Tech Stack:** Existing Next.js 16.3.5, React, TypeScript, Drizzle/Neon HTTP, Neon Auth, Vitest, GitHub Actions; PR #30 adds OpenNext 1.20.8 and Wrangler 4.147.0. Use its locked dependency versions before considering upgrades.

**Spec:** `docs/VANTAGE-PRD.md` in the current planning folder, with this document specifying launch acceptance. The remote repository does not contain that local PRD; copy the agreed PRD into the implementation branch before execution so the spec travels with the code.

**Audit date:** 6 October 2026, Australia/Sydney. Status is a snapshot, not a continuing monitor.

## Implementation update — 6 October 2026

The audit table below records the starting point. The launch branch now implements the code portions of Tasks 1–5: environment-specific Worker/self bindings with schedules disabled; workspace creation and onboarding continuation; profile-provisioned Hacker News and user-added RSS feeds; public URL validation and bounded retrieval; free-source production allowlist and fixture exclusion; database scan leases, deadlines, receipt-safe updates and fair rotation; profile-aware fit and fresh, current-profile queue eligibility before the five-card limit.

Pilot ceilings: three workspaces per scheduled tick, eight eligible sources per workspace, four concurrent collectors, fifty recent documents per opportunity build, seven-day evidence freshness, two-minute scan deadline, five-minute lease and ten-second database fetch timeout. Paid collection remains disabled in production. Ranking and drafting remain deterministic; learning stays off.

Local verification: application tests, scheduled wrapper tests, lint, typecheck and migration generation pass. Next.js compiles and generates pages. Full OpenNext packaging cannot be confirmed locally: Windows rejects packaging symlinks and the WSL filesystem reports input/output errors. CI must pass the full Linux Worker build and staging dry run before merge.

> **Update:** CI moved from CircleCI to GitHub Actions (`a960267`); CircleCI is no longer used. Code review is by cubic (`cubic.yaml`).

**Tasks 6–7 remain ACCESS_PENDING.** The user chose existing Cloudflare and Neon resources. Cloudflare CLI is unauthenticated and the Neon console presents sign-in. No deployment, live migration, auth callback, real ingestion acceptance, custom hostname, schedule activation or rollback has been demonstrated. Authenticate, identify the existing account/project and staging targets, apply `0010_brown_hydra.sql` to staging, then follow the acceptance and promotion sequence below. Do not enable cron until staging passes.

Implementation worktree: `C:/Users/install/Documents/vantage-cloudflare-launch`, branch `codex/cloudflare-launch`, based on PR #30. The canonical PRD is included with the branch. The planning folder's existing edits are preserved.

## 1. What is actually complete

The core code is substantially implemented and merged. A working hosted product has **not been verified**. Closed issues and merged PRs establish delivery of code, not successful live authentication, real ingestion, production migrations, or useful opportunities.

| Area | Confirmed delivery | Remaining qualification |
|---|---|---|
| Foundation | Next.js app, Neon HTTP client, ownership authorization, schema and ten migration journal entries (`0000`–`0009`) on remote `main` | Live Neon project, migration history, and browser session unverified |
| Sources | HN, RSS, Substack, Reddit, X, Product Hunt and YouTube collector implementations; registry, content-hash dedupe, cursor/etag persistence | No GitHub collector; credentials/entitlements and actual live provider runs unverified |
| Monitoring profile | Versioned product description, audience, competitors, topics, URL retrieval and manual-material fallback; [PR #24](https://github.com/sodown4thecause/vantage/pull/24) merged | UI requires an already-existing workspace; does not provision sources |
| Source health | Last-run receipts, explicit degraded/blocked/access/budget states, Settings Sources view; [PR #25](https://github.com/sodown4thecause/vantage/pull/25) merged | Latest receipt is not a durable scan/cost ledger; fixture classification alone does not prevent synthetic queue evidence |
| Opportunity Queue | Clustering, deterministic features/ranking, five-card view, detail and evidence; [PR #26](https://github.com/sodown4thecause/vantage/pull/26) merged | Scheduled tick does not call its builder; fit does not use the monitoring profile |
| Drafting | Saved/edited drafts, citations, restricted claim checks and manual handoff; [PR #27](https://github.com/sodown4thecause/vantage/pull/27) merged | Draft is a deterministic template, not an LLM-generated technical response or comprehensive claim verifier |
| Feedback/outcomes | Useful/not-useful/acted-on events, published URL and basic metric logic; [PR #28](https://github.com/sodown4thecause/vantage/pull/28) merged | Acted-on counts events; surfaced denominator is an update-time estimate; live click/conversion attribution not established |
| Learning | Conservative workspace preference model, replay evaluation and rollback flag; [PR #29](https://github.com/sodown4thecause/vantage/pull/29) merged | Off by default; live usefulness and eligibility not demonstrated; keep off for launch |
| Delivery board | [VANTAGE Delivery Project #3](https://github.com/users/sodown4thecause/projects/3) exists, with 12 items marked Done | Deployment/readiness tasks still need tracking |
| CI on main | `ci/circleci: verify` success for `babefe8daa6f0fa1269626d6b9fb1c601ef3b796` | Existing verification does not prove live Workers execution |
| Cloudflare integration | [PR #30](https://github.com/sodown4thecause/vantage/pull/30) open, mergeable; both `verify` and `workers-build` successful at `e375b4f322a74b80ff60219398d27f97ca62f0ad` | Unmerged; no deploy job, staging isolation, account setup or live deployment demonstrated |
| Reddit Devvit app | `vantagepointdev` contains a React/Hono/tRPC starter with a counter | Separate Reddit-hosted template, not the VANTAGE Cloudflare application |

PR #21 merged the foundation/collector branch. Earlier PRs #1 and #2 are closed without a merge; do not treat them as outstanding launch dependencies. Issues #3–#20 and #22–#23 are closed. Historical GitHub Actions failures exist, but the current checks are CircleCI; old failures should not be mistaken for current build failures.

**Verification limits:** I read current remote code and PR #30 configuration, queried GitHub PRs/checks/issues/project items, and checked official platform docs. I did not rerun the full application test suite or deploy code in this audit. The PR author reports 101 passing tests; successful CI is independently visible, but that exact test count was not independently read from a CI log. GitHub's deployments endpoint returned an empty list; this does not prove that no manually deployed Cloudflare Worker exists. Cloudflare account/plan, deployed URL, secrets, Neon resources and provider accounts remain unverified.

## 2. Workspace and source-of-truth correction

`C:/Users/install/Documents/vantage` is the planning folder: local `master` at `897c7c8`, no remote, existing deletions/untracked documents. Its sibling `vantage-pr1-fixes` and `vantage-m2-hn` checkouts are old branch snapshots, not current main.

A fresh, clean read-only audit clone is available at `C:/Users/install/Documents/vantage-cloudflare-audit-20261006`, remote `sodown4thecause/vantage`, checked out at current main. It also contains local ref `cloudflare-audit-pr30` for inspection. Keep the user's existing edits intact. All application file paths below are relative to the **remote application repository**, not the planning folder.

GitHub evidence is saved under `docs/audit/2026-10-06/` in the planning folder: `pull-requests.json`, `cloudflare-pr.json`, `issues.json`, `project-board.json`, `main-status.json`, `github-deployments.json`.

## Global Constraints

- Opportunity Queue is the primary product; source health belongs under Settings.
- At most five strong queue cards; an empty queue is valid.
- Human review and manual Copy/Open handoff; no autonomous publishing.
- Reuse the current Neon HTTP driver; no D1 migration, Hyperdrive, vector database or new scheduler for first launch.
- Keep fixture content out of production opportunities and drafts.
- Treat missing access as `access_pending`, budget exhaustion as `budget_limited`, and provider failure as failure, never fabricated success.
- Keep `VANTAGE_LEARNING_ENABLED=false` until offline and live evidence justify enablement.
- WSL/Linux for adapter builds; native Windows symlink failure is not a reason to change the app framework. The current WSL shell starts, but `pnpm` resolves to a Windows shim, so fix the project toolchain before local Linux verification.
- Store secrets in environment-specific Worker secrets; do not commit values, include them in build logs, or copy them into the PRD.
- One reviewed release path through GitHub Actions (CI, then Deploy). Migrations are controlled separately from preview/deploy builds.

## Review Focus

1. Fresh user with no workspace/source rows must reach real monitoring without manual SQL. Covered by Task 2.
2. Missing keys, provider failure and fixture-only results must never become believable live opportunities. Covered by Task 3.
3. Duplicate/concurrent scans and a hung provider must not multiply cost or stop later tenants. Covered by Task 4.
4. Real collection must refresh the current queue and use the owning product profile; unrelated high-intent posts must not rank as good fit. Covered by Task 5.
5. Staging auth, self bindings and migrations must not touch production; rollback must preserve data. Covered by Tasks 1, 6 and 7.

## 3. Verified launch gaps and priority

| Priority | Finding and code evidence | Required outcome |
|---|---|---|
| P0 | `app/api/cron/tick/route.ts` calls `runPipeline`, which writes `lead`; only `app/api/opportunities/run/route.ts` calls `buildOpportunities` | Scheduled scans refresh opportunities without an operator POST |
| P0 | `createWorkspaceForCurrentUser` exists in `lib/db/actions.ts` but has no app caller; onboarding/queue require `?workspaceId=`; no source-insert implementation found | Signup provisions/chooses owned workspace, saves profile and creates bounded sources |
| P0 | Paid social clients return fixtures when keys are missing/providers fail; runner persists them; opportunity builder reads all workspace documents | Production fails explicitly; test fixtures cannot contaminate evidence |
| P0 | `budgetUsdMonth`, `laneConsents` and `byokKeys` are schema fields without collector-path enforcement; tick scans sources regardless of paused health | Enforce enabled/consented sources and hard paid-request bounds, or keep paid lanes disabled |
| P0 | Cloudflare PR is open; account, runtime secrets, Neon origins and actual deployment unverified | Isolated staging and then controlled production deployment pass smoke checks |
| P1 before public beta | `computeFeatures(docs)` derives fit from generic purchase words/intent; `buildOpportunities` does not read profile | Product-relative relevance and understandable why-this explanations |
| P1 before unattended scans | HN/RSS outbound fetches lack explicit deadlines; all workspaces run sequentially; no scan overlap guard | Bounded scan time, per-workspace durable lease, actionable partial-failure reporting |
| P1 before public beta | Home is still an M1 scaffold; pages show slice numbers, raw API instructions and missing workspace query hints | Seamless navigation and product wording |
| P1 | CI measures only `.open-next/worker.js` against historical 3/10 MB limits | Validate final upload with `wrangler deploy --dry-run`, all chunks and startup included |
| P2 | GitHub source promised in PRD but missing from registry/source types | Track the scope gap; use selected public GitHub release Atom feeds through RSS initially |
| P2 | Template drafts, approximate metrics, basic clustering and seven-day timing heuristic | Validate usefulness before selling more advanced claims; improve after core loop works |

## 4. Deployment decision and account prerequisites

**Recommendation:** Next.js via PR #30's OpenNext adapter on Cloudflare Workers Paid, with Neon staying external. Cloudflare now recommends vinext for new projects, but also documents maintaining existing OpenNext apps. Finish and verify the existing integration first; reconsider framework migration only if a concrete compatibility failure blocks it. See [Cloudflare OpenNext guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/).

Current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) document 64 MiB uncompressed Worker size, rather than the PR's historical 3 MB/10 MB thresholds, and a one-second startup limit. Use Wrangler's final upload measurement; a small entry file alone says little about the generated server chunks. Confirm limits again when deploying.

Paid HTTP execution has a default 30-second CPU budget, distinct from elapsed waiting time. Scheduled wall time is capped at 15 minutes. Because PR #30 re-enters the HTTP handler through a self service binding, measure that exact execution path; do not infer its effective budget merely from the scheduled handler limit. Initially require a complete pilot sweep under five minutes elapsed and within recorded CPU/subrequest limits, leaving headroom before the 15-minute deadline. These are launch acceptance targets, not platform guarantees.

| Input | Owner | Needed for |
|---|---|---|
| Cloudflare account ID, account access, current plan and billing selection | Account owner | Read existing resources, create environment-specific Workers and deploy |
| Production hostname, and staging hostname or workers.dev URL | Account owner | DNS/custom domain and exact Neon Auth allowed origins |
| Neon production database/auth endpoint and isolated staging equivalents | Account owner + deployment engineer | Schema, sessions and environment isolation |
| Runtime secrets listed below | Account owner | Auth, DB, protected cron and opted-in paid lanes |
| Provider entitlements and a numeric external-data monthly budget | Account owner | Enable paid social collection; start disabled until confirmed |
| GitHub Actions deployment credential (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) restricted to the selected account/resources | Account owner + deployment engineer | Reproducible deployments after verification |

The plan does not assume those inputs are absent; they have not been inspected. First inventory existing resources, then reuse correct ones rather than creating duplicates.

## 5. Task-by-task execution plan

### Task 1: Finish the Cloudflare release baseline and environment isolation

**Depends on:** Account inventory; current PR #30.

**Files:** Modify `wrangler.jsonc`, `worker-entry.mjs`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `README.md`, `.env.example`; reuse `open-next.config.ts` and current package scripts. Add `test/worker-entry.test.mjs` using Node's built-in test runner, with a temporary generated-worker stub.

**Interfaces:** Existing `fetch(request, env, ctx)` remains delegated to OpenNext. Scheduled self fetch remains authenticated with `CRON_SECRET`. Staging uses Worker `vantage-staging` and production `vantage`; each `WORKER_SELF_REFERENCE` binding targets its own environment. Use explicit `--env staging` / `--env production` consistently.

- [ ] Inventory Cloudflare Worker names/deployments/plan and Neon branch/auth configuration; record resource IDs without secret values.
- [ ] Add explicit staging/production config. Declare environment-specific service bindings because bindings are not safely assumed to inherit. Keep staging scheduled triggers empty and production triggers empty until Task 7.
- [ ] Add wrapper checks: delegated fetch; missing secret/binding fails; unauthorized tick fails; non-2xx tick fails; HTTP 200 with failed source/opportunity summaries is reported as partial failure. Existing wrapper logs errors and returns, so platform success alone is insufficient.
- [ ] Run `node --test test/worker-entry.test.mjs` before and after wrapper changes; expected failure then pass for the specified cases.
- [ ] Replace the entry-file size gate with `pnpm exec wrangler deploy --dry-run --env staging --outdir .wrangler/audit-bundle`; store its final upload/startup output as CI evidence.
- [ ] Verify the adapter build with no DB/auth secrets, then preview in workerd with staging-only secrets. Confirm session/API code reads runtime values correctly.
- [ ] Review PR #30 and any new revisions; merge the reviewed integration only after current checks pass. Do not call PR #30 production-ready based solely on its present green build.

**Acceptance:** Final Worker upload is deployable; wrapper failures are detectable; staging cannot bind to the production Worker. OpenNext 1.20.8/Next 16.3.5 compatibility is demonstrated by runtime smoke checks, not inferred from version names.

### Task 2: Complete workspace provisioning, source setup and navigation

**Depends on:** Task 1's runtime-compatible baseline.

**Files:** Reuse/modify `lib/db/actions.ts`, `lib/auth/workspace.ts`, `app/page.tsx`, `app/onboarding/page.tsx`, `app/onboarding/onboarding-form.tsx`, `app/api/profile/route.ts`, `lib/profile/repository.ts`, `app/settings/sources/page.tsx`, `app/api/sources/route.ts`. Extend `test/workspace-authorization.test.ts` and `test/profile-onboarding.test.ts`; add `test/workspace-provisioning.test.ts`.

**Interfaces:** Reuse `createWorkspaceForCurrentUser(name: string)` with server-derived owner ID. Add `getCurrentWorkspace(): Promise<{id: string; name: string} | null>` in `lib/auth/workspace.ts` for session-derived navigation. Add `provisionProfileSources(workspaceId: string, input: MonitoringProfileInput): Promise<void>` in `lib/profile/repository.ts`; it creates HN queries and validated RSS feeds after profile save, respecting the existing unique workspace/source-name constraint. Never accept an owner ID from the client.

- [ ] Add failing checks: unauthenticated create rejected, new user can create owned workspace, another user's workspace rejected, repeated profile setup does not duplicate sources, empty optional feeds do not create invalid sources.
- [ ] Connect the existing workspace action to a minimal create/select flow. Use a single owned workspace for the initial experience without inventing team/member permissions.
- [ ] Add explicit source setup for HN query and RSS/Atom feed URLs. Product/docs URLs are not automatically RSS feeds. Add paid Reddit source setup only after Task 3 permits it.
- [ ] After profile save, show source setup/first scan state and navigate to the resolved workspace Queue. Preserve authorization for any explicit `workspaceId` API requests.
- [ ] Remove scaffold/slice/API-instruction copy from the product pages. Sign-in, onboarding, queue, detail and Settings links retain the user's workspace automatically.
- [ ] Run focused tests and a browser walkthrough from a genuinely fresh staging user.

**Acceptance:** Fresh signup → workspace → profile → sources → first real scan → Queue without manually editing a URL or inserting SQL rows. Empty results are valid; fake opportunities are not required for the walkthrough.

### Task 3: Make live collection honest and bounded

**Depends on:** Task 2's source setup; paid sources additionally require confirmed credentials and numeric budget.

**Files:** Modify `lib/collectors/run.ts`, `lib/collectors/coverage.ts`, `lib/reddit/client.ts`, `lib/x/client.ts`, `lib/producthunt/client.ts`, `lib/youtube/client.ts`, `lib/scavio/client.ts`, `lib/tinyfish/client.ts`. Extend `test/collector-runner.test.ts`, `test/source-coverage.test.ts`, `test/scavio-social-collectors.test.ts`, `test/tinyfish-collectors.test.ts`. If paid lanes are enabled, modify `lib/db/schema.ts` and generate an additive migration for the cost ledger.

**Interfaces:** Keep `runCollector(input: RunCollectorInput): Promise<RunCollectorOutput>`. Enforce common eligibility before executing the collector so cron and manual routes share policy. For paid mode, add `reserveProviderCall({workspaceId, sourceId, provider, maxCostUsd, idempotencyKey}): Promise<{ok: true; reservationId: string} | {ok: false; coverage: "budget_limited"}>` at the existing provider call boundary, backed by atomic DB reservations and an append-only receipt.

- [ ] Add failing checks for paused source, missing consent, missing key, 401/403, 429, provider 5xx, fixtures marked by either `provider=fixture` or `mocked=true`, and retry budget exhaustion.
- [ ] Fail explicitly in production when social providers are unavailable. Keep fixtures through injected test data or explicit local demo mode, not an automatic production fallback.
- [ ] Reject fixture/mock documents at the shared persistence boundary. Exclude pre-existing synthetic rows from opportunity building as Task 5 specifies; remove them from production data only through a reviewed cleanup/backup procedure if any exist.
- [ ] Enforce source count, query/page/result limits and a request deadline. Keep X/Product Hunt/YouTube disabled for the first pilot unless explicitly selected and budgeted.
- [ ] Ship the first staging scan with HN/RSS only and zero paid requests. For a paid launch, add atomic budget reservations, usage receipts, bounded fallback/retry costs and provider-side caps where available. Do not equate a `budget_limited` error label with actual spend enforcement.
- [ ] Verify the selected provider entitlement/data-use conditions from its official account/docs before enabling it. Adapter code alone does not prove those conditions.
- [ ] Run focused tests; perform one controlled live call per enabled paid provider and retain a redacted request/result/cost receipt.

**Acceptance:** No production fixture evidence, paused/unconsented sources never call a provider, zero budget means zero paid calls, and a failing provider produces a truthful source status without stopping independent sources.

### Task 4: Bound scheduled execution and prevent overlapping scans

**Depends on:** Tasks 1 and 3.

**Files:** Modify `app/api/cron/tick/route.ts`, `lib/collectors/run.ts`, HN/RSS/provider request code and `worker-entry.mjs`; add `lib/cron/lease.ts`; modify `lib/db/schema.ts` and generate an additive migration; add `test/cron-tick.test.ts` and extend `test/cron-authorize.test.ts`.

**Interfaces:** Add `claimWorkspaceScan(workspaceId: string, leaseId: string, now: Date): Promise<boolean>` and `releaseWorkspaceScan(workspaceId: string, leaseId: string): Promise<void>` in `lib/cron/lease.ts`. Implement an atomic conditional workspace lease update with a ten-minute expiry; release only the matching lease owner. Store scan lease and latest scan result fields on workspace rather than introducing a general job framework. A skipped overlap does not fetch providers or rebuild opportunities.

- [ ] Add failing checks: missing/wrong cron secret → 401; two simultaneous scans → one lease winner; expired lease reclaimed; old lease owner cannot release new lease; one source timeout does not block later workspaces; missing keys do not consume the paid budget.
- [ ] Keep existing four-source concurrency, but add deadlines at actual outbound request boundaries. Initially set 30-second requests and bound the complete pilot sweep to five minutes; tune only with measured evidence.
- [ ] Make tick skip paused/ineligible sources and workspaces lacking a completed profile. Persist started/completed/partial/failed scan summary with redacted reasons.
- [ ] Stop starting more work as the sweep budget approaches its deadline; record deferred work explicitly. Pilot only the measured number of workspaces/sources that fit; do not silently omit tenants at public launch.
- [ ] Have the wrapper consume and summarize the tick JSON, rather than treating every HTTP 200 as full success. Configuration/fatal failure should throw or otherwise produce a failed invocation.
- [ ] Run focused tests and the local scheduled endpoint, then the deployed staging self-binding path. Measure wall time, CPU, subrequests and DB effects.

**Acceptance:** Repeated/concurrent invocation is safe, hung providers are bounded, and a representative pilot scan fits measured Workers limits. If the workload cannot fit, introduce one Queue message per workspace with idempotency/retry policy; do not add it before this evidence exists.

### Task 5: Connect scans to profile-relative opportunities

**Depends on:** Tasks 2–4.

**Files:** Modify `app/api/cron/tick/route.ts`, `lib/opportunities/run.ts`, `lib/opportunities/features.ts`, `app/queue/page.tsx`; reuse `lib/profile/repository.ts`; extend `test/opportunity-queue.test.ts`, `test/cron-tick.test.ts` and `test/profile-onboarding.test.ts`.

**Interfaces:** Retain `buildOpportunities({workspaceId, limitDocs?})`. Extend `computeFeatures(docs: NormalizedDocument[], profile: Pick<MonitoringProfileView, "productDescription" | "targetCustomer" | "topics" | "competitors">): OpportunityFeatures`. Update every caller, including tests. Reuse existing tokenizer to compare profile terms to evidence before considering embeddings or an LLM.

- [ ] Add failing tick integration check proving collection is followed by `buildOpportunities` for each eligible workspace and its result appears in `opportunityResults`.
- [ ] Add feature checks: identical documents match a relevant profile better than an unrelated profile; generic purchase language alone cannot establish product fit; no profile gives explicit setup state; fixtures/mock evidence are excluded before normalization; sources from other workspaces cannot affect a card.
- [ ] Call opportunity builder after collection. Keep legacy `runPipeline` only if a real pilot user still depends on `/review`; otherwise remove it from the scheduled path while leaving the manual legacy path available during transition.
- [ ] Read the latest owning profile once per build and score product fit deterministically. Explain the matching product/topic plus evidence and timing in plain language.
- [ ] Add concurrent builder/replay checks; use the existing workspace/cluster unique key with atomic conflict handling rather than select-then-insert races. The scan lease protects scheduled work but must not hide manual endpoint races.
- [ ] Recompute or suppress stale queue cards using a documented current timing cutoff so old opportunities do not remain actionable indefinitely. Test expired evidence and repeated scans without resurrecting completed user actions.
- [ ] Run focused tests and prove the deployed scheduler alone refreshes the Queue with live data.

**Acceptance:** Scheduler → real documents → profile-relative opportunities → visible Queue works without a manual build POST. Replays do not multiply cards or evidence. An unrelated product gets different fit; the UI explains the difference.

### Task 6: Provision and validate staging

**Depends on:** Tasks 1–5. Operations task; no product redesign.

**Files:** Update `README.md` and `.env.example`; add `docs/operations/cloudflare-runbook.md` and a repeatable smoke checklist. Record non-secret verification evidence under `docs/operations/evidence/`.

| Secret/setting | Staging value source | Production requirement |
|---|---|---|
| `DATABASE_URL` | Isolated Neon staging branch/project | Production Neon database |
| `NEON_AUTH_BASE_URL` | Auth endpoint verified for staging | Production Auth endpoint |
| `NEON_AUTH_COOKIE_SECRET` | Independent random secret, ≥32 chars | Independent production secret |
| `CRON_SECRET` | Independent random secret | Required even if schedules initially disabled |
| `SCAVIO_API_KEY` | Only if paid Reddit/social lane enabled | Live entitlement and budget required |
| `TINYFISH_API_KEY` | Only if selected lane enabled | Budgeted fallback calls too |
| `PH_DEV_TOKEN`, `YOUTUBE_API_KEY` | Optional selected native-provider lanes | Never required for HN/RSS launch |
| `VANTAGE_LEARNING_ENABLED` | `false` | `false` initially |

`AI_GATEWAY_API_KEY` is currently documented but not used by the draft/ranking implementation; no model key is needed for the present template-based product. Hosted BYOK is not complete merely because a `byokKeys` column exists; keep customer key entry disabled until encryption, validation, retrieval and tenant isolation exist.

- [ ] Establish a native Linux Node/pnpm toolchain matching the lockfile; verify `command -v node`, `command -v pnpm`, `node --version`, `pnpm --version` without resolving Windows shims.
- [ ] Run release checks: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate`, `git diff --exit-code -- drizzle`, `pnpm build`, `pnpm cf:build`, Wrangler dry run. Build checks use no real auth/DB secrets.
- [ ] Back up or confirm recoverability of the target staging database, apply the complete migration journal once with `pnpm db:migrate`, and verify application tables and journal entries. Never `db:push` production or apply app migrations to Neon Auth's managed schema.
- [ ] Store runtime secrets with `pnpm exec wrangler secret put NAME --env staging`, entering values securely; read back names only. Configure exact staging Auth origins/callbacks and the self binding.
- [ ] Deploy staging from the verified SHA. With the current deploy script, use `pnpm run deploy -- --env staging` and confirm the adapter's argument forwarding before first use; if needed use explicit `pnpm cf:build` then `pnpm exec opennextjs-cloudflare deploy --env staging`.
- [ ] Browse signup/login/logout/session refresh; complete fresh onboarding, source setup, live scan, queue/detail, draft edits/approval/copy/open and feedback. Verify 401/403 for unauthenticated and wrong-owner API access using two users.
- [ ] Test missing keys/provider failure, paused source, zero budget, source timeout, duplicate tick, invalid body, invalid URL/private-network redirect and stale opportunities. Profile fetch currently buffers a whole body before slicing; enforce byte limits while streaming and validate public URL/redirect boundaries at profile/RSS input handling.
- [ ] Verify no staging query/provider receipt/domain references production resources; no preview deployment inherits production secrets.

**Acceptance:** Staging evidence includes Worker version/SHA/URL, applied migration journal, auth outcomes, source receipts and complete user walkthrough. Record real examples where available; empty live results remain a valid scan outcome.

### Task 7: Deploy production, observe, and prove rollback

**Depends on:** Staging acceptance, confirmed account/domain/budget inputs and reviewed release.

**Files:** Update runbook and the GitHub Actions deploy workflow; modify production `wrangler.jsonc` trigger/domain settings. No new runtime service required.

- [ ] Make the Deploy workflow deploy staging only after verification and Workers-build succeed. Use one release approval to promote the tested SHA/artifact to production; preview jobs have no production secrets and never migrate production.
- [ ] Capture prior Worker version/config and DB recovery point. Use additive migrations compatible with rollback; separately rehearse restore in an isolated database.
- [ ] Apply reviewed production migrations once, set production runtime secrets and exact Auth origins, deploy with production cron still disabled. Validate HTTPS/custom domain and session behavior on that hostname.
- [ ] Complete a real production user walkthrough and manually trigger one protected scan. Record inserted/skipped counts, opportunity results, provider receipt/cost, elapsed time and source status.
- [ ] Enable the existing three-hour schedule `0 */3 * * *`; keep the earlier local four-hour cost-model assumption out of launch billing calculations. Cloudflare schedules use UTC. Observe all eight expected ticks per day, including at least one automatic invocation with no manual endpoint action.
- [ ] Soak for 24 hours; extend to 48 hours if any run is deferred/partial. Require no unexplained missed ticks, no fixture evidence, no duplicate billable scans, no cross-tenant access and costs within the configured cap.
- [ ] Alert on scan age over six hours, source failures, unexpected cost, auth failures and Workers CPU/memory errors. Avoid notifications for unchanged healthy state.
- [ ] Rehearse rollback to the previous Worker version (or redeploy the previous verified SHA), confirm trigger/binding configuration and login/data access, then restore the candidate release if it passes. Do not assume code rollback reverses database migrations.
- [ ] Publish release evidence and mark the Cloudflare launch complete only when the acceptance checklist below is satisfied.

**Acceptance:** A fresh user can use the whole product on the production domain; autonomous real scans refresh its Queue; runtime/cost limits and rollback are demonstrated.

## 6. Cost and scope controls

[Workers Paid pricing](https://developers.cloudflare.com/workers/platform/pricing/) starts at USD $5/month, with usage above included allowances charged separately. This is the compute baseline, not the total VANTAGE bill. Neon, external data providers, domain, CI and future model usage are separate. Do not buy new subscriptions merely because this plan recommends them; verify current account entitlements first.

At three-hour intervals there are eight ticks/day, approximately 240 ticks in a 30-day month. Estimated paid requests are `workspaces × enabled paid sources per workspace × requests per source per tick × 240`, plus explicitly bounded retries/fallbacks. Provider prices must come from the actual selected account/plan, not the older AnyAPI cost worksheet. Provider request count and maximum charge can differ; reserve worst-case charge before calling and reconcile the receipt afterward.

Initial safe scope: one pilot workspace, HN and selected RSS/Substack/changelog feeds, no paid sources until a numeric cap is set, learning off, template drafts and manual sending. Expand after measured scan duration and usefulness. Use public GitHub release Atom feeds as RSS where sufficient; defer a dedicated GitHub API adapter until releases/discussions require it.

Defer a framework rewrite, D1/Hyperdrive migration, R2/KV caches, Vectorize, Durable Objects, multi-service orchestration, SEO/DataForSEO, automatic posting, multi-format generation, billing/team accounts and a pack marketplace. Add only when the working pilot demonstrates the need. The current template draft can support a pilot; validate response quality before promising model-written replies or comprehensive claim grounding.

Outcome metrics need a later precision pass: count unique acted-on opportunities rather than repeated events, record actual surfaced impressions, and distinguish user-entered published URLs from observed clicks/conversions. These are not blockers for a private pilot if the UI accurately labels estimates; fix before presenting them as reliable product analytics.

## 7. Critical path, effort and completion definition

**Order:** Baseline/isolation → fresh-user provisioning → honest collection/bounds → resilient sweep → current profile-relative Queue → staging → production/soak/rollback.

Indicative engineering effort, assuming access is ready: 0.5–1 day baseline; 1–2 days provisioning; 1–2 days collection/cost gates; 1–2 days cron/queue integration; 0.5–1 day staging; 0.5–1 day production operations plus 24–48 hours elapsed observation. Roughly **5–9 engineering days plus observation**, with paid spend enforcement and discovered auth/runtime compatibility issues able to extend it. This is a planning range, not a measured delivery estimate. A static page deploy can happen earlier but does not meet the user's operational goal.

- [ ] Reviewed Cloudflare integration merged; current release checks pass.
- [ ] Cloudflare production account/Worker/domain confirmed; runtime secret names verified.
- [ ] Correct Neon database and Auth configured; all reviewed migrations applied.
- [ ] Fresh user reaches profile, enabled sources and Queue without manual IDs/SQL.
- [ ] At least one real enabled source emits a verified live receipt; unavailable sources tell the truth.
- [ ] Scheduled collection builds the actual Opportunity Queue using the owning profile.
- [ ] No fixture/mock evidence is eligible for production opportunities or drafts.
- [ ] Duplicate, timeout, partial-failure, pause/consent and budget cases pass.
- [ ] Two-user auth/isolation check passes on the deployed hostname.
- [ ] Draft edit/approval/Copy/Open and feedback persist; no automatic sending occurs.
- [ ] 24–48 hours of scheduler/cost/runtime evidence acceptable.
- [ ] Previous Worker rollback and database recovery procedure demonstrated.

## 8. Documentation and advisory sources

- Current implementation and delivery: [repository](https://github.com/sodown4thecause/vantage), [PR #30](https://github.com/sodown4thecause/vantage/pull/30), [delivery board](https://github.com/users/sodown4thecause/projects/3); local JSON snapshots noted above.
- [Cloudflare OpenNext adapter](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/) — adapter/runtime/deploy flow and current vinext recommendation.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — final upload, startup, memory, CPU and duration distinctions. PR #30 and the advisor response quote older bundle thresholds; current official documentation takes precedence.
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) — current compute baseline and usage pricing.
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) — UTC schedules and local scheduled-handler test endpoint.
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) — environment-specific runtime secrets.
- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) — binding configuration and execution-path context.
- GPT-5.6 Sol was consulted through ChatGPT as instructed. Its advice reinforced runtime-path testing, fresh-user provisioning, fixture exclusion, bounded spend and rollback. It is advisory, not completion evidence; its outdated size-limit claim was checked against current official docs.

This turn produced an audit and execution plan. It did not merge PR #30, change the application, purchase a plan, apply migrations, or deploy a Worker.
