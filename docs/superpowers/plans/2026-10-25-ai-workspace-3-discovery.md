# Agent Discovery and Relevance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn product/competitor research into confirmed strategy and verified relevant conversations.

**Architecture:** Bounded research tools produce cited typed proposals. Server policy validates evidence, approvals, budget and post-level quality before recommendations reach the workspace.

**Tech Stack:** Existing AI Gateway/provider integrations, AI SDK 7, Zod, Neon, Workflows/Queues.

**Spec:** [Approved design](../specs/2026-10-25-ai-workspace-design.md).

## Global Constraints

All [master constraints](2026-10-25-ai-workspace.md) apply. Depends on Plans 1/2. Coordinate issue #139 and active #106 ownership. No new vendor SDK or generic arbitrary provider execution surface. Use existing approved retrieval paths and URL protections.

## Review Focus

Cross-provider budget races, hallucinated competitor identities, private/redirect URLs, search snippets passing as thread text and relevance scores hiding absent evidence must be rejected or explicitly uncertain.

### Task 1: Research evidence and workspace discovery budgets

**Files:** Create `lib/agents/discovery/{types,budget,research}.ts`, `test/discovery-budget.test.ts`, `test/discovery-research.test.ts`; reuse `lib/onboarding/derive.ts`, `lib/providers/paid-call.ts`, approved research-provider adapters and R2 artefact storage. Add any necessary workspace reservation/outbox tables through the single schema owner.

**Interfaces:** `ResearchEvidence = {id:string;url:string;retrievedAt:string;excerpt:string;provider:string;contentKind:'full'|'preview';status:'verified'|'partial'}`. Export `researchProductSite(input:{workspaceId:string;url:string;requestId:string;signal:AbortSignal}):Promise<{evidence:ResearchEvidence[];unknowns:string[]}>`. Export `reserveDiscoverySpend(input:{workspaceId:string;scope:'initial'|'daily_review';estimateUsd:number;requestId:string}):Promise<{reservationId:string}>` and `settleDiscoverySpend(input:{workspaceId:string;reservationId:string;actualUsd?:number;outcome:'success'|'failed'|'ambiguous'}):Promise<void>`. Initial allowance is one workspace lifetime total, daily review is UTC-day total; reserve across providers atomically in addition to existing provider/plan caps. Missing actual cost retains the safe estimate.

- [ ] Write tests for concurrent reservations exceeding $0.50 initial total, $0.05 daily total, cross-provider accumulation, lower provider/plan cap, unknown usage, duplicate request ID, settlement replay, hostile pages, redirects/private targets and inaccessible pages returning explicit unknowns.
- [ ] Run focused tests; verify meaningful failures.
- [ ] Implement bounded existing-provider research, canonical identity verification, evidence provenance and cost reservation/settlement. Set builder defaults of at most 5 selected pages/domain and 3 researched competitor domains per initial run, never exceeding approved budget; show deferred coverage.
- [ ] Run provider contract tests with fake envelopes and a separately authorised staging provider call. Verify evidence/cost records without exposing secrets; review and commit.

### Task 2: Product, competitors, keyword and source proposals

**Files:** Create `lib/agents/discovery/{profile,competitors,keywords,sources,tools}.ts`, `test/discovery-proposals.test.ts`; modify `lib/gtm/chat/tools.ts` and proposal application adapters owned by Plan 2. Reuse source catalogue, profile validation and existing source services. Generate additive proposal-specific tables required by #139 only after reconciling shared proposal storage.

**Interfaces:** Export `DiscoveryPlan = {profile:Record<string,unknown>;competitors:Array<{domain:string;positioning:string;evidenceIds:string[]}>;keywords:Array<{term:string;reason:string;evidenceIds:string[]}>;sources:Array<{type:string;config:Record<string,unknown>;reason:string;evidenceIds:string[];sampleUrls:string[]}>;unknowns:string[]}` with strict schemas. Export `buildDiscoveryPlan(input:{workspaceId:string;evidence:ResearchEvidence[];ownerNotes:string;signal:AbortSignal}):Promise<DiscoveryPlan>`. Convert this output into Plan 2's `StrategyChange` and `createStrategyProposal`; no DB configuration mutation during model generation.

- [ ] Write tests: URL-only cited proposal; unverified competitor name remains unknown; arbitrary/hallucinated evidence ID rejected; 10-20 keywords where supported, fewer with explicit evidence/budget gaps; natural-language exclusion creates revised proposal; zero configuration changes before approval; approved batch writes exact server diff once.
- [ ] Run `pnpm exec vitest run test/discovery-proposals.test.ts`; demonstrate failure.
- [ ] Implement typed agent tools and safe model output normalisation. Show evidence links, uncertainty, sample source matches, cadence/cost proposal and before/after diff in existing chat parts. Persist discovered candidates workspace-scoped, distinct from accepted competitors/sources.
- [ ] Verify URL -> correction -> proposal -> reject/revise -> confirm in staging. Rerun authorisation/approval tests; review and commit.

### Task 3: Verify threads and gate recommended results

**Files:** Create `lib/agents/review/{types,thread,relevance,gate}.ts`, `test/thread-verification.test.ts`, `test/thread-relevance.test.ts`; modify shared build/read seams in `lib/opportunities/run.ts`, `lib/cron/steps.ts` and scan routes only where needed so manual, first-scan and scheduled runs use the same gate. Keep raw collection storage separate from recommendation eligibility.

**Interfaces:** `VerifiedThread = {documentId:string;workspaceId:string;platform:string;url:string;title:string;body:string;replies:string[];retrievedAt:string;replyCoverage:'available'|'partial'|'unavailable';state:'open'|'locked'|'deleted'|'unavailable';evidence:ResearchEvidence[]}`. Export `verifyThread(input:{workspaceId:string;documentId:string;signal:AbortSignal}):Promise<VerifiedThread|null>` using approved retrieval. `ThreadReview = {decision:'recommend'|'reject'|'research_only';reason:string;evidenceIds:string[];domainFit:number;expertiseFit:number;buyerIntent:number;contributionGap:string|null}`. Export `reviewThread(input:{workspaceId:string;thread:VerifiedThread;signal:AbortSignal}):Promise<ThreadReview>` and `isRecommendable(input:{thread:VerifiedThread;review:ThreadReview}):boolean`.

- [ ] Write tests from Plan 1's fixtures: unrelated HN keyword collision rejected, adjacent expertise question accepted without buying intent, preview-only/deleted/locked/reply-unavailable contexts excluded from contribution-ready recommendations, already-answered thread abstains, invalid evidence references and malformed model output fail closed.
- [ ] Run focused tests and confirm intended failures. Keep model/evaluator fixtures deterministic in CI; use paid evaluation only within explicitly available bounded budgets.
- [ ] Implement full-context verification and structured review with independent identity/reference validation. Do not turn numerical model confidence into proof. Calibrate a threshold on development cases and freeze it before running held-out acceptance; report confusion counts, including missed relevant posts.
- [ ] Integrate gate at both recommendation construction and read boundary for legacy/unreviewed candidates; return explicit pending/research-only state rather than leaking old irrelevant recommendations. Record discovered/verified/rejected/recommended separately and persist evaluator/profile versions.
- [ ] Confirm every scan entry point uses the gate, test evaluator timeout/budget denial and rerun live Reddit/HN regression acceptance. Review shared-path performance/cost and commit.
