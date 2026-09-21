# GitHub Delivery Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicate GitHub Actions check with CircleCI and create a repository-linked GitHub Project whose vertical-slice issues are safe for OpenCode, Codex, and human contributors to claim.

**Architecture:** GitHub Project v2 is the delivery index, real GitHub issues are executable work contracts, and pull requests hold implementation evidence. The project uses explicit slice, stage, ownership, effort, and dependency fields; CircleCI is the sole active CI workflow on both open pull-request heads.

**Tech Stack:** GitHub Projects v2, GitHub Issues and Pull Requests, GitHub CLI, GitHub connector, CircleCI, PowerShell, Git

**Spec:** `docs/superpowers/specs/2026-09-19-github-delivery-source-of-truth-design.md`

## Global Constraints

- Keep pull requests #1 and #2 open and unmerged.
- Make `.circleci/config.yml` the sole active CI configuration.
- Use real repository issues for executable work; do not use draft project items.
- Reuse an existing `Vantage Delivery` project or matching issue instead of creating duplicates.
- Request only the GitHub `project` scope if Projects v2 authorization is missing.
- Every agent-ready issue must define outcome, ownership, dependencies, non-goals, acceptance criteria, verification commands, and handoff rules.
- Branches contain the actual issue number and a lowercase hyphenated slug: for example, issue 14 uses `opencode/14-rss-ingestion` for OpenCode or `codex/14-rss-ingestion` for Codex.

## Review Focus

- A historical GitHub Actions failure may remain on old commits; current pull-request heads must not trigger a new Actions run.
- A partial setup must be idempotent: rerunning discovery must reuse existing projects and issues.
- Stacked pull request #2 must incorporate pull request #1's new head without changing its base branch.
- Project fields must contain exact option names so automated item updates cannot silently select a near-match.
- Blocked issues must not appear in the agent-ready queue until their dependency references are satisfied.

---

### Task 1: Remove the Duplicate GitHub Actions Workflow

**Files:**
- Delete: `.github/workflows/ci.yml`
- Verify unchanged: `.circleci/config.yml`

**Interfaces:**
- Consumes: pull request #1 branch `feat/m1-task1-scaffold` at commit `ac4afb7` or its descendant
- Produces: a pull-request head with no GitHub Actions workflow and an unchanged CircleCI verification workflow

- [ ] **Step 1: Capture the current CI baseline**

Run:

```powershell
git status --short --branch
git show HEAD:.github/workflows/ci.yml
git show HEAD:.circleci/config.yml
gh pr view 1 --repo sodown4thecause/vantage --json headRefOid,statusCheckRollup,url
```

Expected: the worktree is clean, both CI files exist, CircleCI is successful on the prior head, and the historical GitHub Actions check is failed.

- [ ] **Step 2: Delete only the GitHub Actions workflow**

Use `apply_patch` with:

```diff
*** Begin Patch
*** Delete File: C:\Users\install\Documents\vantage-pr1-fixes\.github\workflows\ci.yml
*** End Patch
```

- [ ] **Step 3: Verify the CircleCI contract remains intact**

Run:

```powershell
$repo = 'C:\Users\install\Documents\vantage-pr1-fixes'
if (Test-Path "$repo\.github\workflows\ci.yml") { throw 'GitHub Actions workflow still exists' }
rg -n 'pnpm lint|pnpm typecheck|pnpm test|pnpm db:generate|pnpm build' "$repo\.circleci\config.yml"
git -C $repo diff --check
git -C $repo diff -- .circleci/config.yml
```

Expected: the Actions file is absent, all five CircleCI gates are present, the CircleCI diff is empty, and `git diff --check` passes.

- [ ] **Step 4: Commit the workflow removal**

Run:

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: remove duplicate GitHub Actions workflow"
```

Expected: one deletion-only commit.

### Task 2: Publish and Verify Pull Request #1

**Files:**
- No additional file changes

**Interfaces:**
- Consumes: Task 1 commit on `feat/m1-task1-scaffold`
- Produces: updated pull request #1 head with a successful CircleCI check and no new GitHub Actions run

- [ ] **Step 1: Run local acceptance checks**

Run serially:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm db:generate
git diff --exit-code -- drizzle
pnpm build
```

Expected: every command succeeds and migration generation produces no diff.

- [ ] **Step 2: Push the updated pull-request branch**

Run:

```powershell
git push origin feat/m1-task1-scaffold
```

Expected: GitHub reports the new remote head without merging the pull request.

- [ ] **Step 3: Wait for CircleCI and inspect current-head checks**

Run:

```powershell
$head = git rev-parse HEAD
circleci run list --project-slug gh/sodown4thecause/vantage --branch feat/m1-task1-scaffold --page-token ''
gh pr checks 1 --repo sodown4thecause/vantage --watch --interval 10
gh api "repos/sodown4thecause/vantage/commits/$head/check-runs" --jq '.check_runs[] | [.name,.app.name,.status,.conclusion] | @tsv'
```

Expected: CircleCI `verify` succeeds on the new head and no check run on that head is owned by GitHub Actions.

### Task 3: Propagate the CI Change to Pull Request #2

**Files:**
- Merge result only; no independent product changes

**Interfaces:**
- Consumes: updated `origin/feat/m1-task1-scaffold`
- Produces: updated `codex/m2-task2-hn` head that remains based on `feat/m1-task1-scaffold`

- [ ] **Step 1: Confirm the stacked branch is clean**

Run:

```powershell
git -C 'C:\Users\install\Documents\vantage-m2-hn' status --short --branch
git -C 'C:\Users\install\Documents\vantage-m2-hn' fetch origin
```

Expected: no uncommitted changes.

- [ ] **Step 2: Merge the updated foundation branch**

Run:

```powershell
git -C 'C:\Users\install\Documents\vantage-m2-hn' merge --no-edit origin/feat/m1-task1-scaffold
```

Expected: a clean merge or fast-forward that includes the workflow deletion.

- [ ] **Step 3: Run the full stacked-branch checks**

Run from `C:\Users\install\Documents\vantage-m2-hn`:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm db:generate
git diff --exit-code -- drizzle
pnpm build
```

Expected: every command succeeds; the hardened Hacker News tests remain green.

- [ ] **Step 4: Push and verify pull request #2**

Run:

```powershell
git push origin codex/m2-task2-hn
gh pr checks 2 --repo sodown4thecause/vantage --watch --interval 10
$head = git rev-parse HEAD
gh api "repos/sodown4thecause/vantage/commits/$head/check-runs" --jq '.check_runs[] | [.name,.app.name,.status,.conclusion] | @tsv'
```

Expected: CircleCI succeeds, no new GitHub Actions run exists on the current head, and pull request #2 remains open and draft.

### Task 4: Establish GitHub Project Authorization and Identity

**Files:**
- No repository file changes

**Interfaces:**
- Consumes: authenticated GitHub account `sodown4thecause`
- Produces: exactly one repository-linked project named `Vantage Delivery`

- [ ] **Step 1: Discover before creating**

Run:

```powershell
gh auth status
gh project list --owner sodown4thecause --format json
```

Expected: either a readable project list or the specific missing `read:project` scope error.

- [ ] **Step 2: Add the narrow Projects scope only when required**

Run:

```powershell
gh auth refresh -s project
```

Pause at the browser sign-in or consent screen for the user. After consent, rerun `gh auth status` and `gh project list --owner sodown4thecause --format json`.

Expected: the token includes `project`, and project listing succeeds.

- [ ] **Step 3: Reuse or create the project**

Run the discovery query and create only when it returns no exact title match:

```powershell
$projects = gh project list --owner sodown4thecause --format json | ConvertFrom-Json
$project = $projects.projects | Where-Object title -eq 'Vantage Delivery' | Select-Object -First 1
if (-not $project) {
  $project = gh project create --owner sodown4thecause --title 'Vantage Delivery' --format json | ConvertFrom-Json
}
$project | ConvertTo-Json -Compress
```

Expected: one project object named `Vantage Delivery`.

- [ ] **Step 4: Link the repository**

Run:

```powershell
gh project link $project.number --owner sodown4thecause --repo vantage
```

Expected: the project is linked to `sodown4thecause/vantage`.

### Task 5: Create the Project Fields

**Files:**
- No repository file changes

**Interfaces:**
- Consumes: `Vantage Delivery` project number
- Produces: exact workflow metadata for automated and human use

- [ ] **Step 1: Read existing fields**

Run:

```powershell
gh project field-list $project.number --owner sodown4thecause --format json
```

- [ ] **Step 2: Create each missing field with exact options**

Run only for fields that are absent:

```powershell
gh project field-create $project.number --owner sodown4thecause --name Stage --data-type SINGLE_SELECT --single-select-options 'Backlog,Ready,Claimed,In Progress,In Review,Blocked,Done'
gh project field-create $project.number --owner sodown4thecause --name Slice --data-type SINGLE_SELECT --single-select-options 'Foundation,Hacker News,Feeds,Discovery APIs,Qualification,Automated Sweep'
gh project field-create $project.number --owner sodown4thecause --name 'Agent / Worktree' --data-type TEXT
gh project field-create $project.number --owner sodown4thecause --name Effort --data-type SINGLE_SELECT --single-select-options 'S,M,L'
gh project field-create $project.number --owner sodown4thecause --name 'Depends on' --data-type TEXT
```

- [ ] **Step 3: Verify exact field identities and options**

Run:

```powershell
gh project field-list $project.number --owner sodown4thecause --format json
```

Expected: all five custom fields exist once with exact spelling and option values.

### Task 6: Create the Vertical-Slice Issues

**Files:**
- No repository file changes

**Interfaces:**
- Consumes: the approved design and current pull requests
- Produces: eight durable, non-duplicate repository issues

- [ ] **Step 1: Search for exact-title matches**

Use the GitHub connector to search open and closed issues in `sodown4thecause/vantage` for each title below. Reuse an exact match; create only when none exists.

Every created issue must contain these exact headings: `Outcome`, `Scope and ownership`, `Dependencies`, `Non-goals`, `Acceptance criteria`, `Verification`, and `Agent handoff`. The final `Agent handoff` section must say: "Claim by setting Project Stage to Claimed and filling Agent / Worktree. Use an isolated worktree. OpenCode uses a branch such as opencode/14-rss-ingestion; Codex uses a branch such as codex/14-rss-ingestion. Replace 14 and the slug with this issue's actual number and subject. Link the PR, include command evidence, require green CircleCI, and do not self-merge."

- [ ] **Step 2: Create the foundation issue**

Title: `Slice 1: Foundation and CircleCI delivery`

Body requirements:

```markdown
## Outcome
Ship the secure Vantage application foundation with one reliable CircleCI gate.

## Scope and ownership
- `.circleci/config.yml`
- authentication and workspace boundaries
- Drizzle schema and additive migrations
- shared collector contracts and persistence primitives
- PR #1 integration and evidence

## Dependencies
None. Current implementation: #1.

## Non-goals
- Do not merge #1 as part of this issue.
- Do not add another CI provider.

## Acceptance criteria
- GitHub Actions workflow is absent from the current PR head.
- CircleCI passes lint, typecheck, tests, migration drift, and build.
- Workspace authorization and public error contracts remain covered.

## Verification
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate`, `git diff --exit-code -- drizzle`, `pnpm build`.

## Agent handoff
Claim by setting Project Stage to Claimed and filling Agent / Worktree. Use an isolated worktree. OpenCode uses a branch such as opencode/14-rss-ingestion; Codex uses a branch such as codex/14-rss-ingestion. Replace 14 and the slug with this issue's actual number and subject. Link the PR, include command evidence, require green CircleCI, and do not self-merge.
```

- [ ] **Step 3: Create the Hacker News issue**

Title: `Slice 2: Harden the Hacker News signal path`

Body requirements: `Outcome` is a trustworthy Hacker News signal path from upstream retrieval to persisted documents and source health. `Scope and ownership` lists `lib/collectors/hn.ts`, `app/api/collectors/hn/route.ts`, shared runner integration, and focused HN tests. `Dependencies` names PR #1 and current implementation PR #2. `Non-goals` forbids changing other collectors or merging PR #2. `Acceptance criteria` requires bounded pagination, validated upstream responses, exact identity, dedupe, health reporting, and green CircleCI. `Verification` lists `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate`, `git diff --exit-code -- drizzle`, and `pnpm build`. Include the exact `Agent handoff` text from Step 1.

- [ ] **Step 4: Create the feed issues**

Titles:

- `Slice 3A: Deliver RSS and Atom signal ingestion`
- `Slice 3B: Deliver Substack signal ingestion`

RSS owns `lib/collectors/rss.ts`, `app/api/collectors/rss/route.ts`, conditional-request state, and focused tests. It depends on #1 and requires ETag/Last-Modified behavior, deterministic hashes, dedupe, health, safe dates, and authenticated manual execution.

Substack owns `lib/collectors/substack.ts`, `app/api/collectors/substack/route.ts`, and focused tests. It depends on the RSS issue and must reuse the feed contract while preserving Substack-specific source identity and failure reporting.

For each issue, `Outcome` states the end-to-end source-to-document capability. `Scope and ownership`, `Dependencies`, `Non-goals`, and `Acceptance criteria` contain the source-specific details above. `Verification` lists `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate`, `git diff --exit-code -- drizzle`, and `pnpm build`. Include the exact `Agent handoff` text from Step 1.

- [ ] **Step 5: Create the discovery API issues**

Titles:

- `Slice 4A: Deliver Product Hunt discovery ingestion`
- `Slice 4B: Deliver YouTube discovery ingestion`

Product Hunt owns `lib/producthunt/client.ts`, `lib/collectors/producthunt.ts`, its manual route, fixture, and focused tests. It depends on #1 and requires token-gated GraphQL requests, schema validation, identity, dedupe, health, and safe failure reporting.

YouTube owns `lib/youtube/client.ts`, `lib/collectors/youtube.ts`, its manual route, fixture, and focused tests. It depends on #1 and requires API-key validation, pagination bounds, schema validation, identity, dedupe, health, and safe failure reporting.

For each issue, `Outcome` states the end-to-end source-to-document capability. `Scope and ownership`, `Dependencies`, `Non-goals`, and `Acceptance criteria` contain the source-specific details above. `Verification` lists `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate`, `git diff --exit-code -- drizzle`, and `pnpm build`. Include the exact `Agent handoff` text from Step 1.

- [ ] **Step 6: Create the qualification issue**

Title: `Slice 5: Qualify signals into a human review queue`

`Outcome` is a workspace-safe document-to-human-review flow. `Scope and ownership` lists `lib/pipeline/**`, `app/api/pipeline/run/route.ts`, `app/review/page.tsx`, lead persistence, and focused tests. `Dependencies` names all required ingestion issues. `Non-goals` forbids autonomous publishing and unrelated review UI redesign. `Acceptance criteria` requires normalized documents, bounded and validated model inputs, persisted leads, workspace isolation, safe model degradation, and an authenticated review queue. `Verification` lists the full lint, typecheck, test, migration-drift, and build commands. Include the exact `Agent handoff` text from Step 1.

- [ ] **Step 7: Create the automated sweep issue**

Title: `Slice 6: Run an automated resilient source sweep`

`Outcome` is a scheduled sweep that continues safely when one source fails. `Scope and ownership` lists `app/api/cron/tick/route.ts`, `lib/cron/**`, collector registry/runner orchestration, and focused tests. `Dependencies` names every collector issue and the qualification issue. `Non-goals` forbids adding a second scheduler or masking deterministic failures with retries. `Acceptance criteria` requires cron authorization, bounded concurrency, per-source isolation, partial-degradation reporting, health updates, and no secret leakage. `Verification` lists the full lint, typecheck, test, migration-drift, and build commands. Include the exact `Agent handoff` text from Step 1.

### Task 7: Add Issues and Pull Requests to the Project

**Files:**
- No repository file changes

**Interfaces:**
- Consumes: project number, eight issue URLs, pull-request URLs #1 and #2
- Produces: a complete delivery index with accurate metadata

- [ ] **Step 1: Add each issue and pull request idempotently**

For each URL, first inspect `gh project item-list`; run `gh project item-add` only when absent:

```powershell
gh project item-add $project.number --owner sodown4thecause --url https://github.com/sodown4thecause/vantage/pull/1
gh project item-add $project.number --owner sodown4thecause --url https://github.com/sodown4thecause/vantage/pull/2
```

Repeat for the eight exact issue URLs returned by Task 6.

- [ ] **Step 2: Set metadata on current work**

Set the foundation issue and PR #1 to `Slice = Foundation`, `Stage = In Review`, `Effort = L`, and `Depends on` blank. Set the Hacker News issue and PR #2 to `Slice = Hacker News`, `Stage = In Review`, `Effort = M`, and `Depends on = PR #1`.

Resolve and update the current-work URLs with this concrete script:

```powershell
$repo = 'sodown4thecause/vantage'
$foundationIssueUrl = (gh issue list --repo $repo --state all --search '"Slice 1: Foundation and CircleCI delivery" in:title' --json title,url | ConvertFrom-Json | Where-Object title -eq 'Slice 1: Foundation and CircleCI delivery' | Select-Object -First 1).url
$hnIssueUrl = (gh issue list --repo $repo --state all --search '"Slice 2: Harden the Hacker News signal path" in:title' --json title,url | ConvertFrom-Json | Where-Object title -eq 'Slice 2: Harden the Hacker News signal path' | Select-Object -First 1).url
$currentItems = @(
  @{ Url = $foundationIssueUrl; Slice = 'Foundation'; Effort = 'L'; Depends = '' },
  @{ Url = 'https://github.com/sodown4thecause/vantage/pull/1'; Slice = 'Foundation'; Effort = 'L'; Depends = '' },
  @{ Url = $hnIssueUrl; Slice = 'Hacker News'; Effort = 'M'; Depends = 'PR #1' },
  @{ Url = 'https://github.com/sodown4thecause/vantage/pull/2'; Slice = 'Hacker News'; Effort = 'M'; Depends = 'PR #1' }
)
foreach ($item in $currentItems) {
  gh project item-edit $project.number --owner sodown4thecause --url $item.Url --field Slice --value $item.Slice
  gh project item-edit $project.number --owner sodown4thecause --url $item.Url --field Stage --value 'In Review'
  gh project item-edit $project.number --owner sodown4thecause --url $item.Url --field Effort --value $item.Effort
  if ($item.Depends) {
    gh project item-edit $project.number --owner sodown4thecause --url $item.Url --field 'Depends on' --text $item.Depends
  }
}
```

- [ ] **Step 3: Set metadata on future work**

- RSS/Atom: `Slice = Feeds`, `Stage = Ready`, `Effort = M`, `Depends on = PR #1`.
- Substack: `Slice = Feeds`, `Stage = Blocked`, `Effort = S`, `Depends on = RSS/Atom issue`.
- Product Hunt: `Slice = Discovery APIs`, `Stage = Ready`, `Effort = M`, `Depends on = PR #1`.
- YouTube: `Slice = Discovery APIs`, `Stage = Ready`, `Effort = M`, `Depends on = PR #1`.
- Qualification: `Slice = Qualification`, `Stage = Blocked`, `Effort = L`, `Depends on = RSS/Atom, Substack, Product Hunt, and YouTube issues`.
- Automated sweep: `Slice = Automated Sweep`, `Stage = Blocked`, `Effort = M`, `Depends on = all collector issues and Qualification issue`.

Leave `Agent / Worktree` blank for every unclaimed issue.

### Task 8: Verify and Document the Source of Truth

**Files:**
- Modify if external identifiers are worth preserving: `docs/superpowers/specs/2026-09-19-github-delivery-source-of-truth-design.md`

**Interfaces:**
- Consumes: completed GitHub Project, issues, pull requests, and current CI heads
- Produces: evidence that another agent can discover and claim ready work without hidden context

- [ ] **Step 1: Read the project back from GitHub**

Run:

```powershell
gh project view $project.number --owner sodown4thecause --format json
gh project field-list $project.number --owner sodown4thecause --format json
gh project item-list $project.number --owner sodown4thecause --format json
```

Expected: one linked project, five custom fields, eight issues, and two pull requests.

- [ ] **Step 2: Audit agent readiness**

Verify every `Stage = Ready` issue has no unsatisfied issue dependency beyond PR #1, a blank `Agent / Worktree`, exact ownership boundaries, complete verification commands, and the branch/PR handoff contract.

- [ ] **Step 3: Audit blocked work**

Verify Substack, Qualification, and Automated Sweep are `Stage = Blocked` with explicit dependency references that explain how they become ready.

- [ ] **Step 4: Record stable external identifiers**

If the project URL or issue numbers are not already clear from the issue references, append a short `Created artifacts` section to the design spec with the project URL and issue URLs using `apply_patch`. Commit with:

```powershell
git add docs/superpowers/specs/2026-09-19-github-delivery-source-of-truth-design.md
git commit -m "docs: link Vantage delivery project"
git push origin feat/m1-task1-scaffold
```

- [ ] **Step 5: Final no-merge and CI verification**

Run:

```powershell
gh pr view 1 --repo sodown4thecause/vantage --json state,isDraft,baseRefName,headRefName,statusCheckRollup,url
gh pr view 2 --repo sodown4thecause/vantage --json state,isDraft,baseRefName,headRefName,statusCheckRollup,url
git -C 'C:\Users\install\Documents\vantage-pr1-fixes' status --short --branch
git -C 'C:\Users\install\Documents\vantage-m2-hn' status --short --branch
```

Expected: both pull requests remain open, #2 remains based on `feat/m1-task1-scaffold`, CircleCI is green on current heads, and both worktrees are clean.

## 2026-09-21 provider architecture update (PR #21)

Supersedes the earlier Product Hunt GraphQL / YouTube Data API-only discovery framing and the portable-Postgres-without-Neon wording for current work.

### What changed in implementation
- Neon is the documented DB/Auth path (`.env.example`, README).
- Collectors prefer Scavio (YouTube/Reddit/X) and TinyFish (Product Hunt, YT fallback).
- Source type `x` added; Reddit/X routes and fixtures shipped.
- Provider provenance lives on `document.metadata.provider`.

### Board actions completed outside this markdown file
1. Rewrote issues #11, #13, #14, #15, #16 for Neon/Scavio/TinyFish/X.
2. Opened #22 (Product Hunt / TinyFish) and #23 (YouTube / Scavio).
3. Left comments on #12 and #17 for dependency sync.
4. Project v2 field updates still need a GitHub token with `project` scope (current cloud token is forbidden on Projects).

### Verification snapshot from PR #21
- `pnpm test` 42 passing
- `pnpm typecheck` clean

