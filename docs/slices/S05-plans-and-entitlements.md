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
- [ ] Tests per limit: at limit, under limit, over limit; atomic consume under concurrent calls (simulate with sequential mocked statements).
- [ ] Free workspace cannot create a 6th keyword or 2nd project; gets a clear message, not a 500.
- [ ] Daily scoring cap produces `budget_limited` coverage, not an error.
- [ ] Limits editable by SQL without a deploy.

## Out of scope
Payment (S40), credits (S41).
