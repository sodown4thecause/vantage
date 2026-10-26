# Conversational Workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bespoke GTM/interview interactions with streaming AI chat, durable state and exact proposal approvals.

**Architecture:** AI SDK 7 tools run existing authorised server services. Store validated UI messages, versioned proposals and durable job references in Neon. Existing Workflows execute background work.

**Tech Stack:** AI SDK 7, React, Zod, Drizzle/Neon, Next.js/OpenNext Workers.

**Spec:** [Approved design](../specs/2026-10-25-ai-workspace-design.md).

## Global Constraints

All [master constraints](2026-10-25-ai-workspace.md) apply. Read installed v7 docs before selecting SDK APIs. Do not expose model/provider keys in client bundles or use the transcript as permission.

## Review Focus

Cross-tenant message IDs, approval replay/concurrency, interrupted streams, legacy incomplete onboarding and missing resources must not lose state or execute unauthorised work.

### Task 1: Durable message contracts and legacy history

**Files:** Create `lib/gtm/chat/{types,store,legacy}.ts`, `test/gtm-chat-store.test.ts`, `test/gtm-legacy-history.test.ts`; modify `lib/db/schema.ts` and generate the next additive SQL/snapshot. Read `lib/seo-agent/conversations.ts`, `lib/onboarding/interview-store.ts` and `app/workspace/page.tsx`.

**Interfaces:** `GtmUIMessage` is the installed SDK's UI message type with typed safe data/tool parts, not an invented parallel wire format. Export `loadGtmChat(input:{workspaceId:string;conversationId:string}):Promise<{messages:GtmUIMessage[];revision:number}>`; `appendGtmMessages(input:{workspaceId:string;conversationId:string;expectedRevision:number;messages:GtmUIMessage[];requestId:string}):Promise<{revision:number;replayed:boolean}>`; `adaptLegacyTurns(input:{turns:SeoMessageRow[];interview:InterviewState|null}):GtmUIMessage[]`, importing existing types from their producer modules.

- [ ] Write tests refusing foreign conversation IDs, validating persisted tool/data parts, idempotent append, revision conflict, legacy GTM cards and resumable confirmed interview answers. Assert import/schema failures separately from intended regression failures.
- [ ] Run `pnpm exec vitest run test/gtm-chat-store.test.ts test/gtm-legacy-history.test.ts`; verify failures.
- [ ] Implement additive storage/schema and compatibility adapter. Keep server-generated IDs and authoritative confirmed profile outside message prose; preserve old rows for rollback.
- [ ] Generate migrations with the current repo's `pnpm db:generate`; inspect snapshots/drift, rerun tests and review authorisation/migration safety before commit.

### Task 2: Proposal confirmation with atomic application

**Files:** Create `lib/gtm/proposals/{types,repository,apply}.ts`, `app/api/gtm/proposals/[id]/route.ts`, `test/gtm-proposals.test.ts`, `test/gtm-proposal-authorization.test.ts`; one schema owner modifies `lib/db/schema.ts` and generates migrations. Reuse profile/source services through adapters; do not duplicate their validation.

**Interfaces:** Export `StrategyChange = {profile?:Record<string,unknown>;competitors?:string[];keywords?:string[];sources?:Array<{sourceId?:string;type:string;config:Record<string,unknown>;enabled:boolean}>;schedule?:{kind:'scan'|'weekly_recommendations';cron:string;timeZone:string};exclusions?:string[];expertiseNotes?:Array<{text:string;evidenceIds:string[]}>}` validated by strict domain Zod schemas before use. `StrategyProposal = {id:string;workspaceId:string;conversationId:string;strategyVersion:number;payload:StrategyChange;expiresAt:string;status:'pending'|'applied'|'denied'|'superseded'|'expired'}`. Export `createStrategyProposal(input:{workspaceId:string;conversationId:string;strategyVersion:number;payload:StrategyChange}):Promise<StrategyProposal>` and `applyStrategyProposal(input:{workspaceId:string;conversationId:string;proposalId:string;strategyVersion:number;requestId:string}):Promise<{proposalId:string;strategyVersion:number;replayed:boolean}>`. Resolve actor from authenticated context, not a client/model `actorId`. Expertise confirmation timestamps/actor/version are server-written receipt fields; a model cannot declare its own notes confirmed.

- [ ] Write tests for exact approval, batch revision, two competing proposals, stale profile, expiry, denial, ambiguous natural-language approval, cross-workspace/conversation access and two concurrent apply calls. Assert one applied mutation/outbox operation and no duplicate charges/jobs on retry.
- [ ] Run both test files and verify expected failures; add an integration test using real Postgres concurrency for the one-winner invariant.
- [ ] Implement compare-and-swap/atomic batch SQL appropriate to Neon HTTP. Apply multiple mutations and a transactional outbox in one atomic operation; worker retries use the same key. Do not hold a DB transaction across a model/provider call. Record an applied receipt and decision history.
- [ ] Map supported SDK approval state to this server contract. A user confirmation must resolve exactly one matching server proposal; changed payloads require a new approval. Set an initial proposal expiry of 24 hours as a builder default, visible in UI.
- [ ] Pass tests, migration drift and independent security review; commit.

### Task 3: Streaming workspace, typed tools and job state

**Files:** Modify `app/api/gtm/chat/route.ts`, `app/workspace/{page.tsx,workspace-client.tsx,workspace.module.css}`, `lib/gtm/answer.ts`; create `lib/gtm/chat/{agent,tools,jobs}.ts`, `components/gtm-chat-parts.tsx`, `test/gtm-chat-route.test.ts`, `test/gtm-chat-jobs.test.ts`. Update existing workspace tests rather than discarding their protections.

**Interfaces:** Export `createGtmAgent(context:{workspaceId:string;conversationId:string;signal:AbortSignal})` with return type inferred from the installed SDK. Its tools initially read confirmed state, create/apply proposals and read/request permitted jobs; Plan 3 adds discovery tools. Export `GtmJob = {id:string;workspaceId:string;state:'queued'|'running'|'complete'|'partial'|'failed'|'cancel_requested'|'cancelled';health:ScanHealth|null}` using Plan 1's type. `getGtmJob(input:{workspaceId:string;jobId:string}):Promise<GtmJob|null>`; `requestGtmJobCancel(input:{workspaceId:string;jobId:string;requestId:string}):Promise<GtmJob>`. Bind existing scan dispatch/status through this adapter; cancellation is explicit persisted state checked between durable steps, not an HTTP disconnect side effect.

- [ ] Write route/tool tests: authorise before upstream work, reject client-invented tool results/approvals, reserve and settle paid calls, preserve completed parts after interruption, reload job IDs, prevent concurrent generation duplication and never claim completion before job state says complete.
- [ ] Run focused route/job tests; confirm failures.
- [ ] Implement supported UI stream response + `useChat` transport; render safe typed text, evidence, proposal diffs and job status parts. Retain Stop for foreground calls; do not enable incompatible ordinary stream resumption. Persist completion/interruption independent of browser navigation through Worker-supported lifetime handling and test actual runtime behaviour.
- [ ] Replace the primary fixed interview and profile form with conversational turns, legacy confirmed-state summary and clear research gaps. Add loading, errors, retry and keyboard/accessibility behaviour. No mandatory sequence of seven field questions.
- [ ] Verify in staging: stream, stop, reload, two tabs, denied tool, pending confirmation and durable scan progress. Run lint/typecheck/full tests/build/Worker bundle; independent UI and security review; commit.
