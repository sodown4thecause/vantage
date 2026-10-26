# AI Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an entirely conversational GTM workspace that discovers verified relevant threads and offers useful expert contribution suggestions.

**Architecture:** AI SDK 7 chat and typed tools operate existing server services. Neon stores authoritative state; Cloudflare Workflows and Queues execute durable jobs. Configuration changes require exact proposal confirmation.

**Tech Stack:** Existing Next.js, React, TypeScript, AI SDK 7, Zod, Drizzle/Neon, Cloudflare Workers Paid, Workflows, Queues, R2 and Vectorize.

**Spec:** [Approved design](../specs/2026-10-25-ai-workspace-design.md).

## Global Constraints

- The entire workspace becomes an AI chat experience; forms are not the primary interaction.
- The owner chose propose-and-confirm; no autonomous strategy/configuration revisions.
- Suggestions are for users to consider, adapt and express in their own voice. No copy-and-post/prefill flow, automatic posting, voting or forum messaging.
- Use subagents during implementation, exclusive file ownership and separate review. Preserve other agents' changes.
- Every read, mutation and upstream call is workspace-authorised. Models do not establish permission.
- Treat retrieved content as untrusted. Use existing URL protections and bounded, metered provider calls.
- Use installed v7 documentation/source. At review main pins `ai` 7.0.143 and `@ai-sdk/react` 4.0.147; verify again before editing.
- Proposed research allowances are $0.50 initial discovery and $0.05/day review, subject to lower existing plan/provider/workspace caps. Never infer that `runPaidCall.capUsd` alone enforces these workspace/multi-provider totals.
- Generate additive migrations at the next free number with matching snapshots. No production migrations, secrets, deployment or resource changes under plan approval.
- This attached checkout is stale. Execute from a clean current-main worktree after reading its applicable instructions; do not overwrite or reset other work.
- Australian English in product copy. Preserve existing auth and secure billing flows.

## Review Focus

1. Approval replay, stale proposals and two simultaneous tabs must not duplicate changes/jobs/spend: Plan 2, Task 2.
2. A successful search preview is not a verified Reddit thread: Plan 1, Task 2 and Plan 3, Task 3.
3. Closing chat does not cancel durable work or imply completion: Plan 2, Task 3.
4. Keywords overlapping an unrelated HN story must not qualify it: Plan 1, Task 3 and Plan 3, Task 3.
5. User expertise and contribution originality must not be inferred from product marketing or incomplete replies: Plan 4, Task 1.

## Execution order and PR boundaries

| Plan | Deliverable | Gate |
| --- | --- | --- |
| [1: Scan reliability](2026-10-25-ai-workspace-1-scans.md) | Reproduced faults, honest provider health, relevance regression set | Root cause evidence before fixes; live Reddit acceptance |
| [2: Conversation foundation](2026-10-25-ai-workspace-2-chat.md) | Streaming workspace, durable messages/jobs, exact approvals | Plan 1 contracts stable; tenant/replay tests pass |
| [3: Discovery and relevance](2026-10-25-ai-workspace-3-discovery.md) | URL research to confirmed strategy and verified sources/posts | Plan 2 approval/tools available; coordinate #139/#106 |
| [4: Expert suggestions and feedback](2026-10-25-ai-workspace-4-contributions.md) | Evidence-backed suggestions, source feedback, knowledge/outcomes | Plan 3 verified-thread contract available |

Each plan is an independently reviewable PR or a short sequence of dependent PRs. Plans 1 and 2 can overlap only after contracts/ownership are frozen. Do not dispatch plans 3/4 as if their dependencies already exist. Schema/migration ownership stays with one implementer at a time.

## Task 0: Establish execution baseline and ownership

**Files:** Read applicable `AGENTS.md`, `package.json`, `.greptile/config.json`, `.github/CODEOWNERS`, `wrangler.jsonc`; preserve these design/plan files in the execution worktree.

**Interfaces:** Produces `docs/reviews/2026-10-25-ai-workspace-baseline.md`: main SHA, branch/worktree, dependency versions, existing check results, current PR/issue owners, provider availability (names/presence only), and unresolved gates.

- [ ] Read using-git-worktrees and subagent-driven-development skills before execution; inspect `git status`, worktree inventory and latest main. Use a separate feature branch; never reset or move another agent's checkout. Transfer these approved documents as files if a new checkout is needed.
- [ ] Recheck PR #140 and issue #139 prerequisites; read relevant diff/review/runtime evidence. Do not claim its reported fixes are live from CI alone. Reconcile #105/#124, #106, #108, #99/#136 ownership and interfaces.
- [ ] Inspect installed package docs. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm cf:build`, and the repository's Node Worker tests. Record baseline failures separately; use bounded test workers if current instructions require them.
- [ ] Assign implementer/reviewer ownership per task. Tell each worker: you are not alone; preserve others' changes, use the agreed interfaces and do not edit unowned schema/UI/provider files.

## Shared execution and release gate

- [ ] For each task: write meaningful regression/contract tests, demonstrate the expected failure, implement the minimal change, then pass focused tests and review before the next dependency starts.
- [ ] For each PR: run lint, typecheck, complete tests, build, generated migration drift, Worker bundle and Worker entry tests. Capture actual commands/results; never substitute remote green CI for local or staging evidence.
- [ ] Open a reviewable PR linked to the relevant issue without claiming unrelated issue closure. Read all human/automated findings, independently assess them, and fix real defects. Follow applicable review timing and merge rules; this plan does not grant extra merge/deploy authority.
- [ ] Verify staging end to end: URL -> revised proposal -> confirmation -> real Reddit scan -> verified relevant thread -> suggestion -> save/reload -> source-health change proposal. Include denied budget, provider failure, stale approval and cross-workspace refusal.
- [ ] Record provisioned Cloudflare binding health, environment isolation, actual paid allowances/usage and rollback readiness separately from code delivery. Stop at any missing credentials/access gate and name the exact blocked acceptance step; do not report completion.

## Plan self-review

The four plans cover the design's conversational experience, confirmation, research, scan reliability, relevance, suggestions, source health, knowledge freshness, decision history, outcome tracking and optional weekly recommendations. Cross-plan interfaces are defined by producer tasks. The five Review Focus cases are assigned explicit tests. Exact schema migration numbers and SDK method signatures are resolved against the then-current source before implementation, not guessed in this research checkout.

Execution method: subagents. The owner approved this plan set on 26 October 2026 with "Yes". Execute without further plan-confirmation requests; retain verification, review and production boundaries.
