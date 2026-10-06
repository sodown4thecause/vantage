# S05 — Plans and entitlement enforcement

**Track:** Foundations · **Wave:** 1 · **Size:** M · **Owner:** agent · **Depends on:** none · **Unblocks:** S45, S40

## Outcome
Free and Pro limits are defined once and enforced in one place.

## Limits (from the review)
Free: 1 project, 5 keywords, daily digest, 20 AI-scored leads/day, 1 signup Discovery Report, no Reply Briefs, no 3-hourly alerts. Pro ($5): 3 projects, 25 keywords, alerts every 3 hours + Slack/webhooks/API/MCP, 100 scored leads/day, 5 Reddit deep searches/month, Reply Briefs, paid sources via credits.

## Scope
- **DB:** `workspace.plan` already exists (text, default `free`); add `workspace_usage(workspace_id, period date, scored_leads int, deep_searches int, ..., primary key(workspace_id, period))` and `plan_limit(plan text, key text, value int, primary key(plan,key))` (seed by migration) so limits are data, not code.
- **Lib:** `lib/plans/limits.ts` (`getLimits(plan)`, `checkLimit(workspaceId, key)`, `consume(workspaceId, key, n)` using one atomic SQL upsert), `lib/plans/types.ts`.
- **Enforce:** profile save (`lib/profile/repository.ts` keyword/topic count), source creation (`lib/sources/actions.ts`), scoring loop (`lib/opportunities/run.ts` `buildOpportunities`: stop at the daily cap and report `budget_limited`), scan cadence in `lib/cron/scan.ts` (free workspaces scan at most daily).
- **UI:** a `Plan & usage` panel in Settings with current usage vs limit and an "Upgrade" link (target page from S40; until then link to `/pricing`).

## Acceptance criteria
- [x] Tests per limit: at limit, under limit, over limit; atomic consume under concurrent calls (simulate with sequential mocked statements).
- [x] Free workspace cannot create a 6th keyword or 2nd project; gets a clear message, not a 500.
- [x] Daily scoring cap produces `budget_limited` coverage, not an error.
- [x] Limits editable by SQL without a deploy.

## Out of scope
Payment (S40), credits (S41).

## Learned (S05 implementation notes)
- Migration `drizzle/0012_flowery_salo.sql` creates `plan_limit` and `workspace_usage` and seeds free/pro limits with an `INSERT ... ON CONFLICT DO NOTHING`. Change a limit with plain SQL, e.g. `update plan_limit set value = 8 where plan = 'free' and key = 'keywords';`. A missing key falls back to the `free` row, then to `DEFAULT_LIMITS` in `lib/plans/types.ts` (a test keeps that table identical to the seed).
- Limit keys: `projects, keywords, sources, scored_leads_per_day, deep_searches_per_month, discovery_reports, reply_briefs, alerts_3h, scan_interval_hours` (free 24h scans, pro 3h). `reply_briefs` and `alerts_3h` are 0/1 flags for S31/S40 to read via `getLimits(plan)`.
- `consume()` is a single `INSERT ... SELECT ... WHERE n <= limit ON CONFLICT DO UPDATE ... WHERE used + n <= limit RETURNING` statement that reads the limit inside the statement; no rows returned means refused and nothing consumed. `period` is the UTC day for `scored_leads` and the first of the month for `deep_searches`.
- "Scored lead" = a NEW opportunity cluster. Existing clusters keep refreshing when the cap is hit, so a capped workspace never loses leads; the run returns `coverage: "budget_limited"` and `budgetLimited: <count>` instead of an error.
- "Projects" = workspaces owned by one user. `createWorkspaceForCurrentUser` already returns the existing workspace, so the project check is a guard for future multi-project creation.
- Keywords = profile `topics` (checked in `saveMonitoringProfile`; the route returns 403 `plan_limit_exceeded` with a clear message). Sources cap replaced the hard-coded 8 in `addFeed`.
- Scheduled cadence is enforced only on the cron tick without `workspaceId` (manual "Scan now" is unrestricted). A skipped workspace has `updatedAt` touched so it moves to the back of the tick rotation.
- Existing quirk noticed, not fixed (out of scope): `clusterDocuments` in `lib/opportunities/run.ts` merges almost every document into one cluster.
- UI: `/settings/plan` (linked from Sources & Coverage). The Upgrade link points to `/pricing` until S43/S40 ship it.
- Human gates: migration 0012 must be applied to Neon staging/main by the owner (`pnpm db:migrate`). Nothing was applied from this slice.
- Keyword cap grandfathers existing data: `saveMonitoringProfile` passes the latest saved version's topic count, so a workspace with 6 to 12 topics can keep editing as long as it does not add topics (reducing is always fine). A new Free user typing 6+ topics is refused with a field-level message on the topics field (route returns `fieldErrors.topics`).
- `consume()` spends the unit before the opportunity insert and does not refund if a later step throws. Accepted: it is a soft daily cap.
- Source cap is check-then-insert; a double submit at the boundary could exceed it by one. Accepted for S05; close it later with a conditional `INSERT ... WHERE (select count(*) ...) < limit`.
- Tick starvation: the tick takes 3 workspaces per run ordered by `updatedAt`, and skipped not-due workspaces are touched and sent to the back, so a due Pro workspace can wait about ceil(N/3) ticks when there are N workspaces. Fine at pilot size; S45/S40 should filter due workspaces in the tick query instead of after selecting 3.
- `/pricing` does not exist yet (S43/S40): the Upgrade link 404s until then, so do not release this to production users before it lands.
- Zero-limit rows (e.g. deep searches on Free) render "Not included on this plan".

### Manual SQL check for `consume()` (run once on the staging Neon branch after applying 0012, never on main first)
The statement has only been exercised through mocks. Using a throwaway workspace id `W` (an existing staging workspace; the FK requires it):
```sql
-- set the free limit to 1 for the check, then restore it
update plan_limit set value = 1 where plan = 'free' and key = 'scored_leads_per_day';
delete from workspace_usage where workspace_id = 'W' and period = current_date;
-- run this statement twice (it is the statement built by consume() in lib/plans/limits.ts)
insert into "workspace_usage" ("workspace_id", "period", "scored_leads")
select 'W'::uuid, current_date, 1
where 1 <= coalesce((select "value" from "plan_limit" where "plan" = (select "plan" from "workspace" where "id" = 'W'::uuid) and "key" = 'scored_leads_per_day'),
                    (select "value" from "plan_limit" where "plan" = 'free' and "key" = 'scored_leads_per_day'), 20)
on conflict ("workspace_id", "period") do update
  set "scored_leads" = "workspace_usage"."scored_leads" + 1, "updated_at" = now()
  where "workspace_usage"."scored_leads" + 1 <= coalesce((select "value" from "plan_limit" where "plan" = (select "plan" from "workspace" where "id" = 'W'::uuid) and "key" = 'scored_leads_per_day'),
                    (select "value" from "plan_limit" where "plan" = 'free' and "key" = 'scored_leads_per_day'), 20)
returning "scored_leads" as "used";
-- expected: first run returns one row (used = 1); second run returns zero rows and the counter stays 1
update plan_limit set value = 20 where plan = 'free' and key = 'scored_leads_per_day';
delete from workspace_usage where workspace_id = 'W' and period = current_date;
```
Status: not yet run against Postgres (no local server available to the agent); the owner or S00/S01 owner should run it.
