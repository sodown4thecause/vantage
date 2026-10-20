# DataForSEO Foundations + Backlinks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship phases 0 and 1 of the SEO/GEO build plan: a spend-gated, cached DataForSEO layer, and a signed-in `/seo` page that shows a domain's backlink profile and a referring-domain gap against one competitor.

**Architecture:** Every DataForSEO call goes through one gate (`lib/dataforseo/gate.ts`) that checks the cache, then the workspace's monthly SEO credits (plan limit), then the account balance floor and the DataForSEO daily cap, and only then calls the API through the existing `runPaidCall` (global paid switch, atomic daily reservation, `cost_event` ledger row priced from the `cost` DataForSEO returns). Results are trimmed before caching. The `/seo` page reads from the cache only; spending happens only in a server action.

**Tech Stack:** Next 16 (app router, server actions), Drizzle + neon-http, Vitest, DataForSEO v3 REST (Basic auth).

**Spec:** the owner's "SEO/GEO Section: DataForSEO + GSC Build Plan" (19 Oct 2026, summarised under Global Constraints). Phases 2-5 (LLM tracking, scraper, AI keyword data, GSC OAuth, chat/MCP path) are out of scope for this plan.

## Global Constraints

- All paid calls go through the gate. No DataForSEO call outside `lib/dataforseo/gate.ts`.
- Reserve floor: deny when the live balance is below `DATAFORSEO_RESERVE_FLOOR_USD` (default `15`); log a warning when below `DATAFORSEO_ALERT_BALANCE_USD` (default `30`).
- Daily cap: `DATAFORSEO_DAILY_BUDGET_USD` (default `5`), measured from DataForSEO's returned `cost` (summed from `cost_event` where `provider = 'dataforseo'` for the current UTC day), not estimates.
- `runPaidCall` still applies: `VANTAGE_PAID_PROVIDERS_ENABLED=true` and `VANTAGE_PAID_DAILY_BUDGET_USD` must be set or every call is denied.
- Sandbox first: `DATAFORSEO_ENV` is `sandbox` unless set to exactly `live`. Sandbox base URL `https://sandbox.dataforseo.com`, live `https://api.dataforseo.com`. The balance floor is checked only in `live`.
- Credentials: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (Basic auth). Never logged, never sent to the browser.
- Cache TTLs: backlinks 7 days (`604800` s). (AI keyword data 30 days and LLM answers 7 days arrive in later phases.)
- Per-workspace credits: new metered plan limit `seo_credits_per_month` (free `6`, pro `60`); one credit per non-cached DataForSEO request; cache hits are free. A credit is released when the call is denied or fails.
- Workspace scoping: every action runs `authorizeWorkspace` before any credit, cache write or upstream call; refusals return generic messages.
- Migrations are additive and generated with `pnpm db:generate`; commit SQL and snapshot.
- Provider payloads are untrusted data: render as text, never as HTML.

## Review Focus

1. A DataForSEO response with HTTP 200 but a task `status_code` other than `20000` (e.g. `40501` bad target, `40200` out of funds) must be treated as a failure, release the credit, and not be cached. (Task 2, Task 4 tests.)
2. A user typing `https://www.Example.com/pricing?x=1` must hit the same cache entry as `example.com`; `localhost`, IPs and `a b.com` must be rejected before any credit is spent. (Task 5 tests.)
3. A database outage while reading the cache must behave as a miss (and still spend correctly); an outage while writing the cache must not lose the result the user already paid for. (Task 3 tests.)
4. Balance lookup failure in `live` must fail closed (deny), not spend blind. (Task 4 test.)
5. Reloading `/seo?target=...` or a Next prefetch of it must never spend a credit or call DataForSEO. (Task 6: page uses cache-only reads; test that the page loader never calls the gate with `cacheOnly: false`.)

---

### Task 1: Schema, migration and the `seo_credits_per_month` limit

**Files:**
- Modify: `lib/db/schema.ts` (add `dataforseoCache` table; add `seoCredits` column to `workspaceUsage`)
- Modify: `lib/plans/types.ts` (add `seo_credits_per_month` to `LIMIT_KEYS`, `METERED_KEYS`, both `DEFAULT_LIMITS` plans)
- Modify: `lib/plans/limits.ts` (`METERED` map entry and `LIMIT_LABELS` entry)
- Create: `drizzle/00NN_<generated>.sql` + snapshot + journal via `pnpm db:generate`
- Modify: `test/plans.test.ts` (seed test reads every seed file)

**Interfaces:**
- Produces: table `dataforseo_cache` (`cache_key text primary key`, `endpoint text not null`, `response_json jsonb not null`, `fetched_at timestamptz not null default now()`, `expires_at timestamptz not null`, index `dataforseo_cache_expires_idx` on `expires_at`); Drizzle export `dataforseoCache`.
- Produces: `workspace_usage.seo_credits integer not null default 0`; Drizzle field `seoCredits`.
- Produces: `MeteredKey` now includes `"seo_credits_per_month"` with window `"month"`, column `"seo_credits"`, field `"seoCredits"`; label `"SEO credits per month"`.

- [ ] **Step 1: Update `test/plans.test.ts`** so "keeps the code defaults identical to the migration seed" collects `(plan, key, value)` tuples from **every** `.sql` file in `drizzle/` containing `INSERT INTO "plan_limit"`, de-duplicates by `plan:key` (first file wins, matching `ON CONFLICT DO NOTHING`), expects `2 * LIMIT_KEYS.length` distinct entries, and checks each against `DEFAULT_LIMITS`. Add `expect(usagePeriod("seo_credits_per_month", new Date("2026-10-19T05:00:00Z"))).toBe("2026-10-01")`.
- [ ] **Step 2: Run** `pnpm vitest run test/plans.test.ts`. Expected: FAIL (unknown key / count mismatch).
- [ ] **Step 3: Implement** the schema, types and limits changes above. Widen the `METERED` value type's `column`/`field` unions to include the new names.
- [ ] **Step 4: Generate** with `pnpm db:generate`. Then append to the end of the generated SQL file (same precedent as `drizzle/0015_silly_the_order.sql`):

```sql
--> statement-breakpoint
INSERT INTO "plan_limit" ("plan", "key", "value") VALUES
	('free', 'seo_credits_per_month', 6),
	('pro', 'seo_credits_per_month', 60)
ON CONFLICT ("plan", "key") DO NOTHING;
```

- [ ] **Step 5: Verify** `pnpm vitest run test/plans.test.ts test/plan-enforcement.test.ts test/schema-contract.test.ts` passes, and `pnpm db:generate && git diff --exit-code -- drizzle` reports no new changes after the commit is staged (run generate a second time: "No schema changes").
- [ ] **Step 6: Commit** `feat(seo): add DataForSEO cache table and SEO credit limit`.

### Task 2: DataForSEO config and client

**Files:**
- Create: `lib/dataforseo/config.ts`, `lib/dataforseo/client.ts`
- Test: `test/dataforseo-client.test.ts`
- Modify: `.env.example` (document the six `DATAFORSEO_*` variables next to the paid-provider block)

**Interfaces:**
- Produces (`config.ts`):
  - `type DataForSeoEnv = "sandbox" | "live"`
  - `type DataForSeoConfig = { env: DataForSeoEnv; baseUrl: string; login: string; password: string; dailyBudgetUsd: number; reserveFloorUsd: number; alertBalanceUsd: number }`
  - `dataForSeoConfig(env?: Record<string, string | undefined>): DataForSeoConfig | null` — `null` when login or password is blank; numeric settings fall back to defaults (5 / 15 / 30) when missing, non-numeric or negative.
- Produces (`client.ts`):
  - `class DataForSeoApiError extends Error { constructor(readonly statusCode: number, message: string, readonly costUsd: number) }`
  - `type DataForSeoResult<T> = { result: T[]; costUsd: number }`
  - `dataForSeoPost<T>(config: DataForSeoConfig, path: string, task: Record<string, unknown>, opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch }): Promise<DataForSeoResult<T>>` — POSTs `[task]` to `${baseUrl}${path}` with `Authorization: Basic base64(login:password)` and `Content-Type: application/json`; `path` must start with `/v3/`.
  - `getDataForSeoBalance(config: DataForSeoConfig, opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch }): Promise<number>` — `GET /v3/appendix/user_data`, returns `tasks[0].result[0].money.balance`.

Response envelope (confirmed against the official `dataforseo-client` 2.1.9 models): `{ status_code, status_message, cost, tasks: [{ status_code, status_message, cost, result: [...] }] }`; success is `20000` at both levels.

- [ ] **Step 1: Write failing tests** in `test/dataforseo-client.test.ts` with a stub `fetchImpl`:
  - `dataForSeoConfig({})` is `null`; with login+password it returns `env: "sandbox"`, `baseUrl: "https://sandbox.dataforseo.com"`, defaults `5/15/30`; `DATAFORSEO_ENV: "live"` gives `https://api.dataforseo.com`; `DATAFORSEO_DAILY_BUDGET_USD: "abc"` falls back to `5`.
  - `dataForSeoPost` sends `[task]`, header `Authorization: "Basic " + btoa("u:p")`, and returns `{ result, costUsd: tasks[0].cost }`.
  - HTTP 500 → rejects `DataForSeoApiError` with `statusCode: 500`, `costUsd: 0`.
  - HTTP 200 with top-level `status_code: 40100` → rejects with `statusCode: 40100`.
  - HTTP 200, top-level `20000`, task `status_code: 40501`, task `cost: 0.02` → rejects with `statusCode: 40501`, `costUsd: 0.02`.
  - Non-JSON body → rejects `DataForSeoApiError` (`statusCode: 0`).
  - `path` not starting with `/v3/` → throws before fetching.
  - `getDataForSeoBalance` returns `42.5` from `tasks[0].result[0].money.balance`; a missing balance rejects.
  - Error messages never contain the login or password.
- [ ] **Step 2: Run** `pnpm vitest run test/dataforseo-client.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Use `fetchPublicText(url, init, 2_000_000, fetchImpl, 60_000)` from `@/lib/http/public-fetch` (bounds size and time like the Firecrawl client). Treat a missing/non-finite `cost` as `0`. Error messages: `DataForSEO request failed (<code>)` — no response body echoed.
- [ ] **Step 4: Run** the test again. Expected: PASS. Also `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(seo): add DataForSEO REST client and config`.

### Task 3: Response cache

**Files:**
- Create: `lib/dataforseo/cache.ts`
- Test: `test/dataforseo-cache.test.ts`

**Interfaces:**
- Consumes: `dataforseoCache` (Task 1), `DataForSeoEnv` (Task 2).
- Produces:
  - `CACHE_VERSION = "v1"` (bump when a trim shape changes)
  - `TTL_SECONDS = { backlinks: 604_800 } as const`
  - `dataForSeoCacheKey(env: DataForSeoEnv, endpoint: string, params: Record<string, unknown>): string` — sha256 hex (`node:crypto`) of `${CACHE_VERSION}|${env}|${endpoint}|${stableJson(params)}` where `stableJson` sorts object keys recursively.
  - `readDataForSeoCache<T>(key: string, now?: Date): Promise<T | null>` — row with `expires_at > now`; any DB error logs `[dataforseo] cache read failed` and returns `null`.
  - `writeDataForSeoCache(key: string, endpoint: string, value: unknown, ttlSeconds: number, now?: Date): Promise<void>` — upsert on `cache_key` (`onConflictDoUpdate` setting `response_json`, `fetched_at`, `expires_at`); any DB error is logged and swallowed.

- [ ] **Step 1: Write failing tests** (mock `@/lib/db/client` like `test/paid-provider-call.test.ts`): key is identical for `{a:1,b:{c:2,d:3}}` and `{b:{d:3,c:2},a:1}`; differs between `sandbox` and `live`; is 64 hex chars. Read returns the stored `response_json` when present, `null` when no row, `null` when the DB throws. Write calls insert with `expires_at = now + ttl` and does not throw when the DB throws.
- [ ] **Step 2: Run** `pnpm vitest run test/dataforseo-cache.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with the Drizzle query builder (`gt(dataforseoCache.expiresAt, now)`).
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(seo): cache trimmed DataForSEO responses`.

### Task 4: Spend gate

**Files:**
- Create: `lib/dataforseo/gate.ts`
- Test: `test/dataforseo-gate.test.ts`

**Interfaces:**
- Consumes: `dataForSeoConfig`, `dataForSeoPost`, `getDataForSeoBalance`, `DataForSeoApiError` (Task 2); cache functions (Task 3); `consume`, `release` from `@/lib/plans/limits`; `runPaidCall` from `@/lib/providers/paid-call`; `getDb` for the daily-spend query.
- Produces:
  - `type DataForSeoDenial = "not_configured" | "credits_exhausted" | "reserve_floor" | "balance_unknown" | "daily_cap"`
  - `class DataForSeoDeniedError extends Error { constructor(readonly code: DataForSeoDenial, message: string) }`
  - `type GateRequest<R, T> = { workspaceId: string; endpoint: string; task: Record<string, unknown>; ttlSeconds: number; estimateUsd: number; trim: (result: R[]) => T }`
  - `runDataForSeo<R, T>(req: GateRequest<R, T>, opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch; now?: Date }): Promise<{ value: T; cached: boolean }>`
  - `peekDataForSeo<T>(endpoint: string, task: Record<string, unknown>): Promise<T | null>` — cache-only read; never spends; returns `null` when unconfigured or missing.
  - `dataForSeoSpentTodayUsd(now?: Date): Promise<number>` — `select coalesce(sum(cost_usd),0)::text as total from cost_event where provider = 'dataforseo' and ts >= <UTC midnight>`.
  - `resetBalanceCacheForTests(): void`

Order inside `runDataForSeo` (each step decides; stop at the first that refuses):
1. Config `null` → `DataForSeoDeniedError("not_configured")`.
2. Cache hit on `dataForSeoCacheKey(config.env, endpoint, task)` → return `{ value, cached: true }` (no credit, no fetch).
3. `consume(workspaceId, "seo_credits_per_month", 1)`; not allowed → `credits_exhausted`.
4. From here on, any thrown error calls `release(workspaceId, "seo_credits_per_month", 1)` once and rethrows.
5. `live` only: balance (cached in module memory 5 minutes); lookup failure → `balance_unknown`; `< reserveFloorUsd` → `reserve_floor`; `< alertBalanceUsd` → `console.warn("[dataforseo] balance below alert threshold", { balance })`.
6. `dataForSeoSpentTodayUsd() + estimateUsd > dailyBudgetUsd` → `daily_cap` (DB error here also denies as `daily_cap`).
7. `runPaidCall({ context: { workspaceId, sourceKey: "seo" }, provider: "dataforseo", action: endpoint, estimateUsd, signal }, work)` where `work` returns `{ value: trimmed, costUsd }` on success and `{ error, costUsd: err.costUsd }` for a `DataForSeoApiError` (so a known zero-cost failure is not charged the estimate).
8. `writeDataForSeoCache(key, endpoint, trimmed, ttlSeconds)` then return `{ value: trimmed, cached: false }`.

- [ ] **Step 1: Write failing tests** mocking `@/lib/plans/limits`, `@/lib/providers/paid-call` (pass-through that awaits `work()` and returns `value` or throws `error`), `@/lib/dataforseo/cache`, `@/lib/db/client` and injecting `fetchImpl`. Cases:
  - unconfigured → `not_configured`, no consume, no fetch.
  - cache hit → `{ cached: true }`, `consume` and `fetchImpl` not called.
  - consume refused → `credits_exhausted`, no fetch.
  - `live`, balance `10` → `reserve_floor`, `release` called once, no POST.
  - `live`, balance lookup rejects → `balance_unknown`, `release` called once.
  - `live`, balance `25` → succeeds and `console.warn` called.
  - `sandbox` → `user_data` is never fetched.
  - spent today `4.99`, estimate `0.05`, cap `5` → `daily_cap`, `release` called once.
  - success → `runPaidCall` called with `provider: "dataforseo"`, `action: endpoint`, `estimateUsd`; cache written with the trimmed value and `ttlSeconds`; returns `{ cached: false }`.
  - task `status_code: 40501` → rejects, `release` called once, cache not written.
  - `peekDataForSeo` returns the cached value and never calls `consume` or `fetch`.
- [ ] **Step 2: Run** `pnpm vitest run test/dataforseo-gate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in the order above.
- [ ] **Step 4: Run** again, then `pnpm vitest run test/paid-provider-call.test.ts test/plans.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(seo): gate DataForSEO calls on credits, balance floor and daily cap`.

### Task 5: Backlinks wrappers

**Files:**
- Create: `lib/dataforseo/backlinks.ts`
- Test: `test/dataforseo-backlinks.test.ts`

**Interfaces:**
- Consumes: `runDataForSeo`, `peekDataForSeo` (Task 4); `TTL_SECONDS` (Task 3).
- Produces:
  - `normalizeTarget(input: string): string | null` — trim; add `https://` when no scheme; take `URL.hostname`, lowercase, strip one leading `www.`; reject when empty, longer than 253, no dot, an IPv4/IPv6 literal, `localhost`/`*.local`/`*.internal`, or any label not matching `/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/`.
  - `type BacklinkSummary = { target: string; rank: number; backlinks: number; referringDomains: number; referringMainDomains: number; brokenBacklinks: number; spamScore: number; firstSeen: string | null }`
  - `type ReferringDomain = { domain: string; rank: number; backlinks: number; spamScore: number; firstSeen: string | null }`
  - `type Anchor = { anchor: string; backlinks: number; referringDomains: number }`
  - `trimSummary(result: unknown[]): BacklinkSummary`; `trimReferringDomains(result: unknown[]): ReferringDomain[]`; `trimAnchors(result: unknown[]): Anchor[]` — read DataForSEO fields `rank, backlinks, referring_domains, referring_main_domains, broken_backlinks, backlinks_spam_score, first_seen` (summary), `result[0].items[]` with `domain, rank, backlinks, backlinks_spam_score, first_seen` (referring domains) and `anchor, backlinks, referring_domains` (anchors); missing numbers become `0`, missing strings `null`, items without a string `domain`/`anchor` are dropped.
  - `referringDomainGap(own: ReferringDomain[], competitor: ReferringDomain[]): ReferringDomain[]` — competitor domains not in `own` (case-insensitive), excluding the own target domain itself, sorted by `rank` desc.
  - Task builders (exported so the page can peek with the same params): `summaryTask(target)`, `referringDomainsTask(target)`, `anchorsTask(target)` returning `{ endpoint, task, estimateUsd }`:
    - summary: `/v3/backlinks/summary/live`, `{ target, include_subdomains: true, exclude_internal_backlinks: true, backlinks_status_type: "live" }`, estimate `0.025`
    - referring domains: `/v3/backlinks/referring_domains/live`, `{ target, include_subdomains: true, exclude_internal_backlinks: true, backlinks_status_type: "live", limit: 1000, order_by: ["rank,desc"] }`, estimate `0.0625`
    - anchors: `/v3/backlinks/anchors/live`, `{ target, include_subdomains: true, exclude_internal_backlinks: true, backlinks_status_type: "live", limit: 100, order_by: ["backlinks,desc"] }`, estimate `0.03`
  - `fetchBacklinkSummary(workspaceId, target, opts?)`, `fetchReferringDomains(workspaceId, target, opts?)`, `fetchAnchors(workspaceId, target, opts?)` → `runDataForSeo` with the builder's values and `TTL_SECONDS.backlinks`.
  - `peekBacklinkReport(target: string): Promise<{ summary: BacklinkSummary | null; referringDomains: ReferringDomain[] | null; anchors: Anchor[] | null }>`

- [ ] **Step 1: Write failing tests:** `normalizeTarget` table — `"https://www.Example.com/pricing?x=1"`→`"example.com"`, `"blog.example.co.uk"`→`"blog.example.co.uk"`, `"EXAMPLE.com."` handled (trailing dot stripped), and `null` for `""`, `"localhost"`, `"127.0.0.1"`, `"[::1]"`, `"a b.com"`, `"printer.local"`, `"example"`. Trim functions on a fixture shaped like the DataForSEO models (including an item with no `domain`, dropped). `referringDomainGap` returns only competitor-only domains, ignores case, excludes the own domain, sorted by rank desc. Each `fetch*` passes the builder's `endpoint`, `task`, `estimateUsd` and `ttlSeconds: 604800` to a mocked `runDataForSeo`.
- [ ] **Step 2: Run** `pnpm vitest run test/dataforseo-backlinks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(seo): backlink summary, referring domains, anchors and gap`.

### Task 6: `/seo` page and server action

**Files:**
- Create: `app/seo/page.tsx`, `app/seo/actions.ts`
- Modify: `components/shell.tsx` (nav item `{ key: "seo", label: "SEO", href: "/seo" + q }`, extend `NavKey`)
- Modify: `lib/seo.ts` (add `"/seo"` to `PRIVATE_PATHS`)
- Test: `test/seo-action.test.ts`; extend `test/blog.test.ts` robots assertion only if it enumerates paths

**Interfaces:**
- Consumes: `authorizeWorkspace`, `getCurrentWorkspace`; Task 5 exports; `DataForSeoDeniedError`; `checkLimit` for showing credits left.
- Produces:
  - `runBacklinkReport(formData: FormData): Promise<void>` (`"use server"`) — reads `workspaceId`, `target`, `competitor` (optional); authorizes first (refused → `redirect("/seo?error=forbidden")`); normalizes targets (invalid → `error=invalid_target`); runs summary, referring domains, anchors for `target`, and referring domains for `competitor` when given; then `redirect` to `/seo?workspaceId=…&target=…[&competitor=…]`. Errors map to `error=` codes: `DataForSeoDeniedError.code` (`not_configured`, `credits_exhausted`, `reserve_floor`, `balance_unknown`, `daily_cap`), `PaidCallDeniedError` → `paused`, anything else → `failed`. Keep the user's normalized target in the redirect so the form stays filled.
  - Page messages (generic, no provider detail): `not_configured` "SEO data is not set up yet.", `credits_exhausted` "You have used this month's SEO credits. They reset on the 1st (UTC); Pro includes more.", `reserve_floor`/`balance_unknown`/`daily_cap`/`paused` "SEO lookups are paused for today. Try again tomorrow.", `invalid_target` "Enter a domain like example.com.", `failed` "That lookup failed. You were not charged a credit.", `forbidden` "Unable to load this page."
  - Page: authorizes like `app/queue/page.tsx`; form (POST to the action) with domain + optional competitor; "SEO credits left this month: N" from `checkLimit(workspaceId, "seo_credits_per_month")`; when `target` is present, renders from `peekBacklinkReport` only: summary stats, top 100 referring domains table (domain, rank, backlinks, first seen), top 20 anchors, and, with `competitor`, the gap table ("Links your competitor has that you don't, among each site's top 1,000 referring domains by rank"). Label sample data honestly: when `DATAFORSEO_ENV` is not `live`, show "Sandbox data: not real figures." Provider strings render as React text only. `export const dynamic = "force-dynamic"`, `metadata.robots = { index: false }`.

- [ ] **Step 1: Write failing tests** in `test/seo-action.test.ts` (mock `@/lib/auth/workspace`, `@/lib/dataforseo/backlinks`, and `next/navigation` `redirect` to throw a marker): unauthorized → redirect contains `error=forbidden` and no fetch function called; `target: "localhost"` → `error=invalid_target`, no fetch; success → three fetches for the target, one `fetchReferringDomains` for the competitor, redirect to `/seo?workspaceId=ws&target=example.com&competitor=rival.com`; `fetchBacklinkSummary` rejecting `new DataForSeoDeniedError("credits_exhausted", "x")` → `error=credits_exhausted`; a generic `Error` → `error=failed`. Assert `authorizeWorkspace` is called before any fetch.
- [ ] **Step 2: Run** `pnpm vitest run test/seo-action.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the action, the page, nav and `PRIVATE_PATHS`.
- [ ] **Step 4: Verify** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus `node --test test/worker-entry.test.mjs test/scan-run.test.mjs test/queue-consumer.test.mjs`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(seo): signed-in backlink report with competitor gap`.

## Owner tasks outside this plan (from the spec's week 1)

- Create DataForSEO sandbox credentials and set `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` in Cloudflare (staging first, `DATAFORSEO_ENV` unset = sandbox).
- Start the Google OAuth consent screen and verification paperwork for Phase 4.
- Confirm Backlinks prices on the DataForSEO pricing page; adjust the three estimates in `lib/dataforseo/backlinks.ts` if they changed.

## Known limitation

`runPaidCall` serialises paid calls per UTC day (one open reservation at a time). Fine for Backlinks (sub-second live calls); Phase 2's 120 s LLM Responses calls will need a per-provider reservation before batching.
