# GitHub Delivery Source of Truth Design

## Purpose

Create one durable, repository-linked GitHub Project that tells human and agentic contributors what Vantage should deliver next, what they may safely own, what each task depends on, and what evidence is required before review. CircleCI becomes the only active CI provider so account-level GitHub Actions billing failures no longer obscure the real build state.

## Outcomes

- Contributors can find work that is genuinely ready without reconstructing the Ref plan or reading every pull request.
- Each work item delivers an end-to-end product capability rather than an isolated technical layer.
- OpenCode and other coding agents receive explicit file ownership, dependency, test, branch, and pull-request contracts.
- Pull requests #1 and #2 remain unmerged and are represented as current delivery work.
- New commits are evaluated by CircleCI without a duplicate GitHub Actions workflow.

## Source-of-Truth Boundary

The GitHub Project named **Vantage Delivery** is the authoritative delivery index. Repository issues contain executable work contracts. Pull requests contain implementation and review evidence. The Ref plan remains historical input, while this project owns current sequencing and status.

Project state must not be inferred from chat transcripts, local branches, or agent memory. An agent changes a task's state and ownership fields when claiming or handing off work, and links its pull request to the issue.

## Project Model

The project is linked to `sodown4thecause/vantage` and contains real issues and the two existing pull requests. Draft project items are not used for executable work because they cannot provide the same durable issue, branch, and pull-request linkage.

### Fields

| Field | Type | Values or format | Purpose |
| --- | --- | --- | --- |
| Stage | Single select | Backlog, Ready, Claimed, In Progress, In Review, Blocked, Done | Explicit delivery state |
| Slice | Single select | Foundation, Hacker News, Feeds, Discovery APIs, Qualification, Automated Sweep | End-to-end capability grouping |
| Agent / Worktree | Text | Agent name and isolated worktree or branch | Prevent overlapping ownership |
| Effort | Single select | S, M, L | Scheduling and review sizing |
| Depends on | Text | Issue or pull-request references | Visible dependency gate |

The existing GitHub `Status` field may remain for compatibility, but `Stage` is the workflow authority because its exact options can be created consistently.

### Views

- **Delivery board:** grouped by `Stage`, showing all active work.
- **Vertical slices:** grouped by `Slice`, ordered by dependency.
- **Ready for agents:** filtered to `Stage = Ready`.
- **Review queue:** filtered to `Stage = In Review`.
- **Blocked:** filtered to `Stage = Blocked`.

If GitHub CLI support cannot create saved views, the project and fields remain valid; the views are then created through the GitHub UI without changing the data model.

## Vertical Slices

### 1. Foundation and Delivery

Delivers the runnable application foundation, authentication and workspace boundaries, persistence schema, shared collector contracts, migrations, and CircleCI verification. Pull request #1 represents the current implementation. Removing `.github/workflows/ci.yml` is part of this slice; `.circleci/config.yml` remains the sole CI configuration.

### 2. Hacker News Signal

Delivers a hardened Hacker News path from upstream retrieval through validation, bounded pagination, persistence, deduplication, source health, and manual authenticated execution. Pull request #2 represents the current implementation and remains stacked on pull request #1 until the foundation is mergeable.

### 3. Feed Signals

Delivers RSS/Atom and Substack ingestion through conditional requests, source state, content hashing, persistence, health reporting, and manual routes. Work may be split into two issues only when each issue independently exercises the shared end-to-end collector contract.

### 4. Discovery APIs

Delivers Product Hunt and YouTube ingestion through authenticated upstream clients, validated fixtures, persistence, deduplication, source health, and manual routes. Product Hunt and YouTube are separate claimable issues because they use different credentials and failure modes.

### 5. Qualification and Review

Delivers normalized documents, intent scoring, persisted leads, and an authenticated human review queue. The slice must expose a coherent document-to-review flow; model calls must fail safely and must not bypass workspace ownership.

### 6. Automated Resilient Sweep

Delivers scheduled collection across enabled sources with bounded concurrency, per-source failure isolation, authorization, observability, and a response that reports partial degradation without hiding failures.

## Issue Contract

Every executable issue contains:

1. **Outcome:** the user-visible or operator-visible capability.
2. **Scope and ownership:** exact files or modules the agent owns.
3. **Dependencies:** issue or pull-request gates and required base branch.
4. **Non-goals:** adjacent changes the task must not absorb.
5. **Acceptance criteria:** behavior that must be demonstrated.
6. **Verification commands:** exact lint, typecheck, test, migration, and build commands relevant to the slice.
7. **Agent handoff contract:** branch naming, isolated worktree expectation, project-field updates, and required PR evidence.

An agent claims a task by setting `Stage` to `Claimed` and filling `Agent / Worktree` before editing. It moves the task to `In Progress` with its first commit, to `In Review` only after CircleCI passes, and to `Done` only after merge or an explicit maintainer decision.

Branches created for these issues use `opencode/<issue-number>-<short-slug>` for OpenCode and `codex/<issue-number>-<short-slug>` for Codex. Agents must not merge their own pull requests unless the issue explicitly grants that authority.

## Initial Items and State

- Foundation and CircleCI: represented by issue plus pull request #1; `Stage = In Review` after the workflow removal and a successful CircleCI rerun.
- Hardened Hacker News collector: represented by issue plus pull request #2; `Stage = In Review` after it incorporates the updated foundation branch and CircleCI succeeds.
- RSS/Atom collector: claimable issue, dependent on pull request #1.
- Substack collector: claimable issue, dependent on the RSS/Atom collector contract.
- Product Hunt collector: claimable issue, dependent on pull request #1.
- YouTube collector: claimable issue, dependent on pull request #1.
- Qualification and review queue: blocked issue, dependent on the required ingestion slices.
- Automated resilient sweep: blocked issue, dependent on all collector contracts and the qualification pipeline.

## CI Change

Delete `.github/workflows/ci.yml` from the pull request #1 branch. Preserve `.circleci/config.yml` with its frozen dependency install, lockfile-keyed pnpm cache, lint, typecheck, unit tests, migration-drift check, and production build.

Merge the updated pull request #1 branch into the pull request #2 branch so both current heads use CircleCI only. Historical failed GitHub Actions checks remain attached to old commits; acceptance is based on the current heads showing successful CircleCI checks and no newly triggered GitHub Actions run.

## Failure and Recovery Rules

- If GitHub Projects authorization is absent, stop project creation and request only the `project` scope. Do not broaden repository or organization permissions.
- If issue creation succeeds but project insertion fails, preserve the issues and retry only the project linkage after authorization is corrected.
- If a project or issue with the intended identity already exists, update and reuse it rather than creating a duplicate.
- If CircleCI fails after workflow removal, retain the commits and diagnose the CircleCI failure; do not restore GitHub Actions merely to produce another check.
- Every external mutation is verified by reading the resulting project, issues, pull-request heads, and check rollups.

## Acceptance Criteria

- `.github/workflows/ci.yml` is absent from the current heads of pull requests #1 and #2.
- CircleCI passes on both updated pull-request heads.
- A repository-linked **Vantage Delivery** project exists with the specified fields.
- The current pull requests and all planned vertical-slice issues appear in the project with accurate slice, stage, dependency, and ownership metadata.
- Every future-work issue contains the complete agent handoff contract and executable verification commands.
- Neither pull request is merged as part of this work.

## 2026-09-21 provider architecture update (PR #21)

PR https://github.com/sodown4thecause/vantage/pull/21 is the current implementation head for foundation + collectors. The delivery board issues were rewritten to match:

### Foundation
- **Neon Postgres** (pooled `DATABASE_URL`) + **Neon Auth** (`NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`) is the supported runtime path.
- Drizzle schema/migrations under `lib/db/**` and `drizzle/**` remain the persistence contract.

### Collector providers
Prefer search/fetch scrapers over full browser agents:

| Source | Primary | Fallbacks |
| --- | --- | --- |
| YouTube | Scavio comments | TinyFish → YouTube Data API → fixture |
| Product Hunt | TinyFish search+fetch | PH GraphQL → fixture |
| Reddit | Scavio `reddit.search` | fixture |
| X | Scavio `x.search` | fixture |
| HN / RSS / Substack | existing collectors | unchanged |

Env keys: `SCAVIO_API_KEY`, `TINYFISH_API_KEY`, optional `PH_DEV_TOKEN`, `YOUTUBE_API_KEY`. Documents store `metadata.provider`.

### Issue map (open board)
- #11 Slice 0 Neon foundation (In Review via PR #21)
- #12 Slice 1 onboarding/profile
- #13 Slice 2 collector contracts/registry (largely in PR #21)
- #14 Slice 2A Reddit via Scavio
- #15 Slice 2B HN/RSS/Substack
- #16 Slice 2C X via Scavio (replaces prior GitHub-adapter framing)
- #22 Slice 2D Product Hunt via TinyFish
- #23 Slice 2E YouTube via Scavio
- #17–#20 queue, drafting, outcomes, learning (unchanged goals; depend on collectors above)

### Paths of record
`lib/collectors/**`, `lib/scavio/**`, `lib/tinyfish/**`, `lib/reddit/**`, `lib/x/**`, `lib/youtube/**`, `lib/producthunt/**`, `app/api/collectors/**`.

GitHub Projects field edits may require a token with the `project` scope; issue bodies are the executable contracts when project metadata cannot be updated.

