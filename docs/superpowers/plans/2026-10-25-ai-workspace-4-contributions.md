# Expert Suggestions and Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help users develop accurate useful expert responses in their own voice, then improve source strategy from observed quality and outcomes.

**Architecture:** Verified threads feed bounded AI contribution generation and independent quality review. Chat displays suggestions and evidence, with source changes routed through exact approval. Knowledge/outcome tools use the same tenancy and provenance contracts.

**Tech Stack:** Existing contribution/rules validators, AI SDK 7, Neon, R2/Vectorize where enabled, scan Workflows.

**Spec:** [Approved design](../specs/2026-10-25-ai-workspace-design.md).

## Global Constraints

All [master constraints](2026-10-25-ai-workspace.md) apply. Depends on Plan 3's verified-thread/review contracts. No ready-to-post, copy/paste, prefilled forum field, promotion, invented expertise or rank guarantee. Use research notes/angles where community rules prohibit AI text or remain unknown.

## Review Focus

Invented first-person experience, semantically duplicated advice, unsupported claims hidden in questions, stale community rules and misleading vote/outcome attribution must not become approved suggestions.

### Task 1: Evidence-backed expert contribution suggestions

**Files:** Modify `lib/drafting/{contribution,generate,repository,rules}.ts`; create `lib/drafting/{suggestion,quality}.ts`, `test/expert-suggestions.test.ts`; extend `test/contribution-quality.test.ts`, `test/drafts-route.test.ts`, `test/subreddit-rules.test.ts`. Add typed tools in `lib/gtm/chat/tools.ts` through its owner.

**Interfaces:** Export `ContributionSuggestion = {kind:'draft_suggestion'|'research_notes'|'abstain';text:string;angle:string;gap:string|null;evidenceIds:string[];personalise:string[];checks:{grounded:boolean;original:boolean;rules:'permitted'|'prohibited'|'unknown'}}`. Export `createContributionSuggestion(input:{workspaceId:string;thread:VerifiedThread;review:ThreadReview;confirmedExpertise:string[];signal:AbortSignal}):Promise<ContributionSuggestion>`. Export `reviewContributionSuggestion(input:{workspaceId:string;thread:VerifiedThread;suggestion:ContributionSuggestion;signal:AbortSignal}):Promise<{accepted:boolean;reasons:string[]}>`. Existing `GeneratedDraft` storage is adapted internally without deleting existing drafts.

- [ ] Write tests for a specific useful reply angle, promotion/CTA rejection, unsupported first-person experience, unconfirmed marketing claims, semantic repetition of existing replies, unsupported advice/questions, forged evidence IDs, unknown replies, prohibited/unknown AI rules and no useful addition -> abstain.
- [ ] Run the focused drafting/rules tests and show intended failures.
- [ ] Migrate raw gateway generation to installed AI SDK 7 structured generation without changing existing metering/routing policy; preserve claim/reference validation and add independent semantic quality review. Do not discard existing model-routing protections or treat lexical/quote overlap as semantic proof.
- [ ] Retrieve timestamped community rules and actual available replies through approved bounded paths. Emit research notes/angles for prohibited/unknown venues, and draft suggestions only for verified permitted contexts with adequate thread/reply coverage. Keep missing evidence visible; no fixed word count requirement.
- [ ] Rerun tests and labelled human review examples. Record measured acceptance, rejection reasons and provider costs separately from CI; review and commit.

### Task 2: Chat suggestion experience and removal of copy-and-post framing

**Files:** Modify `components/gtm-chat-parts.tsx`, `app/workspace/workspace-client.tsx`, `app/opportunities/[id]/{page.tsx,draft-panel.tsx}` and other actual copy/open controls found by scoped search; extend `test/draft-handoff.test.ts`; create `test/suggestion-presentation.test.ts`.

**Interfaces:** Render Plan 4 Task 1's `ContributionSuggestion` parts through the existing `GtmUIMessage` union. Reuse saved artefact services; no forum posting/clipboard automation API is introduced. Exact copy: "Use these ideas to write your own response. Check the facts and community rules before you contribute."

- [ ] Write tests asserting the adaptation guidance, visible evidence/gap/uncertainty, research-only state, no combined copy/open/prefill action and safe rendering of hostile retrieved HTML. Existing draft records remain readable; user-authored saved notes are preserved.
- [ ] Run focused presentation/handoff tests and verify failure on current copy-and-post framing.
- [ ] Implement suggestion/refinement/save tools and accessible chat cards. Replace generated-comment copy-and-open controls across the migrated experience with evidence, revise/save and neutral source-reading links. Keep user-authored export behaviour outside this change unless it encourages unchanged forum posting.
- [ ] Verify actual browser flow with keyboard, mobile layout, reload and source links. Assert no posting/messaging requests occur. Run UI tests/typecheck/build; review product wording and commit.

### Task 3: Source health, knowledge freshness, decisions and outcomes

**Files:** Create `lib/gtm/learning/{health,knowledge,outcomes,weekly}.ts`, `test/gtm-source-health.test.ts`, `test/gtm-learning.test.ts`; integrate `lib/cron/steps.ts`, `lib/gtm/chat/tools.ts`, existing saved artefact/profile/retrieval services and proposal repository through their owners. One schema owner generates any additive knowledge/outcome/subscription records.

**Interfaces:** `SourceHealth = {sourceId:string;verified:number;recommended:number;rejected:number;failed:number;costUsd:number;coverage:'complete'|'partial'|'unknown'}`; export `summariseSourceHealth(input:{workspaceId:string;since:string}):Promise<SourceHealth[]>` and `proposeSourceAdjustment(input:{workspaceId:string;conversationId:string;sourceId:string;signal:AbortSignal}):Promise<StrategyProposal|null>`. Export `readKnowledge(input:{workspaceId:string}):Promise<Array<{id:string;text:string;evidenceIds:string[];retrievedAt:string;stale:boolean}>>`; `recordOutcome(input:{workspaceId:string;opportunityId:string;kind:'useful'|'not_useful'|'owner_reported_reply'|'observed_engagement';note:string;observedAt:string;requestId:string}):Promise<{id:string}>`; `buildWeeklyRecommendations(input:{workspaceId:string;signal:AbortSignal}):Promise<{summary:string;evidenceIds:string[];proposalIds:string[]}>`. Weekly generation is on-demand or explicitly opted-in using existing scheduling infrastructure, not automatic external sending.

- [ ] Write tests: repeated irrelevant results yield a source-change proposal with no automatic mutation; zero useful results remains honest; cost preview distinguishes estimates from actuals; stale knowledge warns rather than asserting freshness; decision history reads exact approved receipts; owner reports are labelled and do not prove rank/causation; no subscription means no proactive run/notification; cross-workspace reads/writes fail.
- [ ] Run both test files and confirm failures.
- [ ] Implement bounded health aggregation after scans and chat tools for cited knowledge, freshness, strategy cost/coverage previews, decision history and outcomes. Store supplied expertise through Plan 2's `expertiseNotes` proposal and confirmation receipt; resolve `confirmedExpertise` server-side from those records, never from a model/client claim. Knowledge facts retain source provenance; expertise claims retain owner confirmation. Reuse confirmation for proposed refresh/configuration spend beyond standing limits. No second vector store or new scheduler service.
- [ ] Implement weekly recommendations from confirmed state and observed outcomes; opt-in is a separately confirmed schedule/budget proposal. Show recommendations in workspace history; any owner email/notification must use an existing authorised opt-in and is distinct from contacting forum participants.
- [ ] Run focused/full gates and staging feedback loop: noisy scan -> proposed adjustment -> deny/revise -> confirm -> next scan -> observed outcome. Review privacy, cost and tenancy; commit.

## Final acceptance

- [ ] Execute the master plan's complete staging journey and negative cases. Report code, CI, runtime/provider evidence, resources/migrations and remaining launch gates separately. Do not claim Reddit fixed, accurate recommendations or expertise-quality suggestions solely from mocked tests or document completion.
