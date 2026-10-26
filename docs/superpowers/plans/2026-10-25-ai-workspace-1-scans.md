# Scan Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Reddit collection works and distinguish provider failures, partial results and irrelevant candidates.

**Architecture:** Preserve existing discovery/hydration collectors and scan runtime; fix only demonstrated faults. Add shared safe health categories and a labelled relevance regression set.

**Tech Stack:** Existing TypeScript collectors, paid-call ledger, Vitest and Cloudflare scan Workflows.

**Spec:** [Approved design](../specs/2026-10-25-ai-workspace-design.md).

## Global Constraints

All constraints and release gates in [the master plan](2026-10-25-ai-workspace.md) apply. No invented live scan evidence or unrelated forum substitutions. Investigate root cause before changes.

## Review Focus

First-topic failure, later-topic failure and all-provider failure must be distinguishable; previews remain unverified; missing credentials must not look like zero results; cursor movement cannot skip failed coverage; irrelevant HN matches must be represented in regression fixtures.

### Task 1: Reproduce and isolate the reported failure

**Files:** Inspect `lib/reddit/client.ts`, `lib/collectors/reddit.ts`, `lib/collectors/run.ts`, `lib/activation/{dispatch,run,budget}.ts`, `lib/cron/{scan,steps}.ts`, `worker-entry.mjs`; modify only the proven fault's file(s). Extend `test/reddit-firecrawl-lane.test.ts`, `test/reddit-partial-search.test.ts`, `test/scan-source-action.test.ts` or the existing first-scan tests corresponding to that boundary. Create `docs/reviews/2026-10-25-reddit-scan-evidence.md`.

**Interfaces:** Consumes existing `CollectorContext`, `CollectorResult`, `fetchRedditPostsWithMeta`, activation dispatch and paid-call contracts. Produces a sanitised reproduction and regression; retain existing public return contracts until Task 2's additive health contract.

- [ ] Read exact errors/job evidence via authorised staging/scan records. Trace confirmed source -> dispatch -> budget -> selected provider -> discovery -> hydration -> persistence -> queue. Record status, stage and IDs, not credentials/raw customer content. If historical evidence is unavailable, say so and reproduce on staging.
- [ ] Write a regression named for the observed failure and assert the correct boundary result (e.g. retained partial documents, denied spend, provider error, dispatch retry). Add separate cases for first query failure, later failure after genuine results, no results and cancellation; assert cursor preservation for unprocessed coverage.
- [ ] Run the selected Vitest file(s) with `pnpm exec vitest run <paths>`; confirm the observed defect fails for the intended assertion, not a broken mock/import. If it cannot be reproduced, gather evidence rather than choosing a speculative fix.
- [ ] Implement only the demonstrated correction; add bounded health instrumentation where the failing boundary lacks evidence. Coordinate existing fixes rather than duplicating PR #140/#130 logic.
- [ ] Rerun focused tests and complete an actual staging Reddit scan. Document discovery and hydration evidence, genuine result count, partial state and cost; if blocked, record the provider/stage and retain the unmet live acceptance gate.
- [ ] Commit only the owned fix, tests and evidence to its PR branch; obtain independent review.

### Task 2: Add truthful scan health

**Files:** Create `lib/scan/health.ts`, `test/scan-health.test.ts`; modify `lib/collectors/run.ts`, `lib/cron/steps.ts` and existing scan-status response mapping only where needed. Preserve the existing client contract additively.

**Interfaces:** Export `ScanIssue = {stage:'dispatch'|'discovery'|'hydration'|'persist'|'review'; kind:'provider_disabled'|'access_pending'|'budget_exhausted'|'rate_limited'|'upstream_failed'|'invalid_payload'|'aborted'; provider?:string; retryable:boolean}` and `ScanHealth = {state:'complete'|'partial'|'failed'|'cancelled'; discovered:number; verified:number; issues:ScanIssue[]}`. Export `summariseScanHealth(input:{discovered:number;verified:number;completed:boolean;cancelled:boolean;issues:ScanIssue[]}):ScanHealth`. A hydrated post needs validated identity/full context; a preview contributes only to discovered.

- [ ] Write table-driven tests: completed empty search -> complete/0; missing access -> failed; genuine results plus later failure -> partial; preview-only -> verified/0; cancellation -> cancelled; malformed provider envelope -> invalid_payload. Assert safe categories rather than raw exception messages.
- [ ] Run `pnpm exec vitest run test/scan-health.test.ts`; expect missing implementation/assertion failure.
- [ ] Implement the pure mapper and additive producer wiring; preserve existing documents/cursors. Never map provider denial to empty success or silently switch platform identity.
- [ ] Rerun health and existing scan/first-scan tests; independently review state transitions and cost settlement before committing.

### Task 3: Establish relevance evaluation fixtures

**Files:** Create `test/fixtures/thread-relevance.json`, `test/thread-relevance-fixtures.test.ts`, `docs/reviews/2026-10-25-thread-quality-baseline.md`. Read `lib/opportunities/{features,run}.ts` and current fit/intent scoring to identify the integration seam for Plan 3.

**Interfaces:** Each labelled case has `{id,split:'development'|'acceptance',profile:{domain,audience,expertise,exclusions},thread:{platform,url,text,replies,contextState},expected:'recommend'|'reject'|'research_only',reason}`. Fixture suite validates schema and coverage; Plan 3 owns model/gate implementation.

- [ ] Add genuine authorised historical HN mismatch examples if available, plus clearly labelled synthetic keyword collisions, relevant non-buying-intent questions, already-answered threads, previews, hostile instructions and deleted/locked posts. Never commit private customer content without appropriate handling.
- [ ] Write schema/coverage assertions that both splits include relevant positives, hard negatives and abstentions; ensure no acceptance case is duplicated into development. Run the test to show absent/invalid fixture failure.
- [ ] Complete fixtures and report the existing system's behaviour only where actually measured. Document unavailable historical reproductions and any stored raw-candidate/recommendation distinction.
- [ ] Run `pnpm exec vitest run test/thread-relevance-fixtures.test.ts`, review labels, commit. Plan 3 will calibrate on development and enforce acceptance independently.
