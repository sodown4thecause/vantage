# Community GTM Phase Implementation Plan

> **For agentic workers:** Use superpowers:dispatching-parallel-agents for the independent collector and social-provider tasks; execute shared integration and contribution drafting here. Write failing behavioral tests before code and perform one independent whole-branch review.

**Goal:** Collect useful AI developer-tool conversations and prepare evidence-backed, community-aware drafts for human review.

**Architecture:** Extend existing collectors, settings and draft persistence. Keep automated scans free; opt-in paid calls use a shared atomic budget gate and existing cost events.

**Tech Stack:** Next.js 16.3, TypeScript, Drizzle/Neon, TinyFish, Scavio, provider-neutral HTTP, Vitest, Cloudflare.

**Spec:** `docs/superpowers/specs/2026-10-07-community-gtm-phase.md`

## Global Constraints

- Work only in `codex/community-gtm-phase`; preserve other checkouts.
- No social posting, messaging, access-control bypass or secret output.
- Source/data schema and registry integration are owned by the primary agent.
- Provider actions require opt-in and explicit budget; missing access stays visible.
- Do not implement subscriptions or change the login-first usage-billing decision.

## Review Focus

- A real successful zero-result response must not trigger fixtures or paid escalation.
- HN/Stack Overflow URLs cannot be disguised as a permissive platform to obtain prose.
- A model's claim ledger must match supplied quotes and all proposed draft claims.
- Failed or timed-out paid calls may have been billed; retain a conservative reservation.
- Source installation and copy approval must enforce workspace ownership and plan limits.

### Task 1: Curated source catalog and developer collectors

**Files:** `lib/communities/catalog.ts`, `lib/collectors/github.ts`, `lib/collectors/stackoverflow.ts`, `lib/collectors/alexandria.ts`, `lib/firecrawl/client.ts`, `lib/collectors/linkedin.ts`, corresponding tests.

**Interfaces:** Existing Collector/CollectorContext/CollectorResult. Source enum additions `github`, `stackoverflow`, `linkedin`; Alexandria uses existing `web_search`. RSS-based catalog entries retain existing types. Paid helper is the spec contract.

- [x] Add collection tests and normalized bounded collectors; verify empty/error/SSRF/backoff behavior.
- [x] Add curated public feed/community entries, verified provider contracts and source notes.
- [x] Primary agent wires enums, migrations, registry, free scan allowlist, catalog installation and settings UI with authorization tests.

### Task 2: TinyFish Reddit, experimental Gateway X and Scavio social fallback

**Files:** `lib/reddit/client.ts`, `lib/x/client.ts`, `lib/x/gateway.ts`, `lib/collectors/reddit.ts`, `lib/collectors/x.ts`, social routing tests.

**Interfaces:** Preserve exported client names and existing post shapes; allow optional `topComments` and actual provider provenance. Use `runPaidCall` before paid Agent/Gateway/Scavio paths; pass AbortSignal.

- [x] Verify installed Scavio/TinyFish and current Gateway contracts. Native X search is unverified; the experiment scores Scavio-acquired posts with Grok.
- [x] Add routing/empty/access/abort/cited-post tests, implement, run focused tests.
- [x] Fixtures require explicit demo configuration, and no invented timestamps/post identifiers.

### Task 3: Budget gate, optional DeepSeek triage and contribution drafts

**Files:** `lib/providers/paid-call.ts`, `lib/drafting/contribution.ts`, `lib/drafting/rules.ts`, existing draft repository/panel, tests, shared schema and migration. Model requests stay in the contribution module.

**Interfaces:** Existing draft API remains authenticated. Additional quality metadata is JSON, versioned and visible. The model/brief decision travels with persisted drafts.

- [x] Prove budget opt-in/atomic reservation/uncertain failure behavior, including durable settlement fencing.
- [x] Add contribution policy/claim matching/abstention tests, implement brief and draft generation with fixed host endpoints.
- [x] Wire optional Inco triage and premium Gateway generation to manual draft creation.
- [x] Re-check edited drafts and human venue review at approval; expose quality and evidence in UI.

### Task 4: Integrate, verify and review

- [x] Update env example, canonical PRD, phase/source runbook and current slice status.
- [x] Run lint, typecheck, full tests, migration generation/drift and build; inspect every result. Results: `docs/research/2026-10-07-phase-validation.md`.
- [x] Independent branch review and fix any material issues.
- [ ] Open and attach PR; wait ten minutes, address reviews and CI; merge only when ready under app instructions. Report provider/deployment gates precisely.
