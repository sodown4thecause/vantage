# Vantage Project Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the current Vantage vertical slices as a trustworthy production beta, collect enough real workspace evidence to evaluate learning safely, and close the remaining GitHub work without making speculative personalization a launch gate.

**Architecture:** Preserve the existing Next.js, Neon, Drizzle, collector, opportunity, drafting, and outcome boundaries. Add a strict production boundary around synthetic collector data, a small operational/readiness layer around existing routes, and browser-level acceptance coverage for the complete user journey. Treat per-workspace learning as a separate post-launch experiment that can only affect ranking behind a reversible feature flag after an evidence gate and offline replay pass.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, Neon Postgres/Auth, Drizzle ORM, Vitest, CircleCI, Vercel Cron, Scavio, TinyFish.

**Spec:** `docs/superpowers/specs/2026-09-19-github-delivery-source-of-truth-design.md`

## Global Constraints

- Keep Neon Postgres and Neon Auth as the supported production persistence and identity path.
- Preserve workspace ownership checks on every workspace-scoped read and write.
- Never present fixture or mocked documents as live coverage or real opportunities in production.
- Keep generated drafts human-reviewed; no autonomous posting is introduced.
- Use only typed provider integrations and the existing collector registry; do not expose generic provider requests to the model.
- Per-workspace learning must be explainable, versioned, isolated, reversible, and disabled below its evidence threshold.
- Every delivery PR must pass `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate`, `git diff --exit-code -- drizzle`, and `pnpm build` with CI-equivalent non-secret environment placeholders.

## Review Focus

- Missing or failed provider credentials must degrade source health without inserting synthetic production documents; Task 1 adds this contract.
- A signed-in user must not read or mutate another workspace through any API or page; Task 2 extends the authorization matrix.
- A scheduled sweep must tolerate one provider failure, record the degraded source, and continue other workspaces; Task 3 adds the acceptance test.
- Deployment with incomplete required configuration must fail before serving misleading partial behavior; Task 4 adds the release preflight.
- Learning must produce byte-for-byte baseline rankings when disabled, rolled back, or below threshold; Task 6 adds replay and integration tests.

---

## Current State and Definition of Done

As reviewed on 2026-10-05, GitHub issues #11-#19 are closed, their delivery PRs are merged, no pull request is open, and issue #20 is the only open issue. The current branch passes lint, typecheck, 67 tests, migration drift detection, and a production build. GitHub Project v2 field values could not be re-read because the local GitHub CLI token is invalid and lacks a usable authenticated Projects connection; reconcile the board in Task 5.

The production beta is complete when Tasks 1-5 pass against a deployed environment and at least one real workspace completes onboarding, live collection, opportunity review, draft generation, and outcome capture. Task 6 is post-launch and does not block that release.

### Task 1: Make Synthetic Data Explicit and Production-Safe

**Files:**
- Create: `lib/collectors/fixture-policy.ts`
- Modify: `.env.example`
- Modify: `lib/reddit/client.ts`
- Modify: `lib/x/client.ts`
- Modify: `lib/youtube/client.ts`
- Modify: `lib/producthunt/client.ts`
- Modify: `lib/collectors/coverage.ts`
- Test: `test/fixture-policy.test.ts`
- Test: `test/scavio-social-collectors.test.ts`
- Test: `test/tinyfish-collectors.test.ts`

**Interfaces:**
- Produces: `fixtureFallbackAllowed(env?: NodeJS.ProcessEnv): boolean`, true only outside production or when `ALLOW_FIXTURE_COLLECTORS=true` is explicitly set.
- Produces: provider failures that remain visible to the existing collector runner so source health becomes degraded or failing.
- Consumes: existing provider metadata and coverage classification.

- [ ] **Step 1: Add failing fixture-policy tests**

Assert that production defaults to false, development/test defaults to true, and the explicit flag is parsed strictly rather than by generic truthiness.

- [ ] **Step 2: Run the focused tests and confirm the production case fails**

Run: `pnpm test -- test/fixture-policy.test.ts test/scavio-social-collectors.test.ts test/tinyfish-collectors.test.ts`

Expected: FAIL because clients currently return fixtures whenever live providers are missing or fail.

- [ ] **Step 3: Implement and apply `fixtureFallbackAllowed`**

Provider clients may return fixtures only when the policy allows it. Otherwise preserve the provider error or throw a configuration error without logging secrets.

- [ ] **Step 4: Keep fixture coverage visibly non-live**

Assert that explicitly enabled fixture batches remain degraded and carry `provider: "fixture"`; never promote them to healthy coverage.

- [ ] **Step 5: Document `ALLOW_FIXTURE_COLLECTORS` and run the full verification shield**

Expected: all commands in Global Constraints pass and no Drizzle diff remains.

- [ ] **Step 6: Commit**

Commit message: `fix(collectors): prevent synthetic production fallbacks`

### Task 2: Close the Workspace Authorization and End-to-End Journey Gaps

**Files:**
- Create: `test/api-workspace-authorization.test.ts`
- Create: `test/e2e/beta-journey.spec.ts`
- Create: `playwright.config.ts`
- Modify: `package.json`
- Modify: workspace-scoped handlers under `app/api/**/route.ts` only where the new matrix finds a gap.
- Modify: pages under `app/onboarding`, `app/settings/sources`, `app/queue`, and `app/opportunities/[id]` only where the journey cannot complete.

**Interfaces:**
- Consumes: `authorizeWorkspace(workspaceId)` and existing API contracts.
- Produces: one repeatable browser journey from sign-in/onboarding through outcome capture, plus a route-level cross-workspace denial matrix.

- [ ] **Step 1: Inventory every workspace-scoped route and add denial tests**

For unauthenticated requests expect 401; for a valid session targeting another workspace expect 403; for malformed workspace identifiers expect a safe 4xx without internal details.

- [ ] **Step 2: Run the authorization test and fix only demonstrated gaps**

Run: `pnpm test -- test/workspace-authorization.test.ts test/api-workspace-authorization.test.ts`

Expected: PASS with no cross-workspace read or write path.

- [ ] **Step 3: Add the beta journey test**

Cover monitoring-profile creation, source status, opportunity generation/listing, opportunity detail, grounded draft generation/edit/approval, and useful/not-useful plus acted-on outcome capture. Use seeded local data; do not require paid provider calls in CI.

- [ ] **Step 4: Run the journey locally and repair broken user-visible transitions**

Run: `pnpm exec playwright test test/e2e/beta-journey.spec.ts`

Expected: one complete journey passes with no manual URL editing after onboarding.

- [ ] **Step 5: Add the browser job to CircleCI and run the full verification shield**

Keep provider-live smoke tests out of pull-request CI; those belong to Task 4 deployment acceptance.

- [ ] **Step 6: Commit**

Commit message: `test(beta): cover authorized end-to-end journey`

### Task 3: Add Operational Receipts for Scheduled Collection

**Files:**
- Create: `lib/operations/sweep-receipt.ts`
- Create: `app/api/operations/health/route.ts`
- Modify: `app/api/cron/tick/route.ts`
- Modify: `lib/db/schema.ts`
- Create: the generated Drizzle migration and snapshot.
- Test: `test/cron-resilience.test.ts`
- Test: `test/operations-health.test.ts`

**Interfaces:**
- Produces: an append-only, workspace-scoped sweep receipt with start/end time, per-source result, document/opportunity counts, and sanitized failure categories.
- Produces: an authenticated health summary that reports freshness and degraded/failed sources without exposing provider secrets or raw exceptions.
- Consumes: existing collector and pipeline results.

- [ ] **Step 1: Write failing receipt and partial-failure tests**

Assert that one failed source does not stop remaining sources/workspaces, the failure is recorded, and secrets or request payloads do not appear in receipts.

- [ ] **Step 2: Add the minimal receipt schema and generate its migration**

Use an append-only table keyed by workspace and sweep identifier; keep detailed per-source results in typed JSONB to avoid a premature event subsystem.

- [ ] **Step 3: Persist one receipt per scheduled sweep and expose an authorized summary**

The endpoint must use workspace authorization and return freshness, counts, and failure categories only.

- [ ] **Step 4: Run focused tests and the full verification shield**

Expected: partial-failure tests pass, migration generation is stable, and production build succeeds.

- [ ] **Step 5: Commit**

Commit message: `feat(operations): record resilient sweep receipts`

### Task 4: Deploy and Prove the Production Beta

**Files:**
- Create: `scripts/release-preflight.ts`
- Create: `docs/runbooks/production-beta.md`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `vercel.json` only if the live deployment reveals a schedule/config mismatch.

**Interfaces:**
- Produces: `pnpm release:preflight`, which validates required configuration names and safe production policy without printing values.
- Produces: a runbook with deploy, migrate, smoke-test, rollback, and incident steps.
- Consumes: live Vercel, Neon Auth/Postgres, Scavio/TinyFish configuration, and the Task 3 health receipt.

- [ ] **Step 1: Add preflight tests for missing and unsafe production configuration**

Required production inputs are `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, and `CRON_SECRET`. At least one configured live acquisition path must exist for every source enabled in the beta workspace, and fixture fallback must be disabled.

- [ ] **Step 2: Implement `release:preflight` and document exact recovery paths**

The command reports variable names and policy failures only, never secret values.

- [ ] **Step 3: Provision or select the production Neon/Vercel resources and apply migrations**

Record deployment identifiers and timestamps in the release evidence, not credentials in the repository.

- [ ] **Step 4: Execute live smoke tests with one controlled beta workspace**

Verify Neon Auth callback/session, workspace isolation, one successful real collection per enabled source, cron authorization, opportunity creation, draft flow, outcome capture, and Task 3 health freshness. A fixture-sourced document is a failed production smoke test.

- [ ] **Step 5: Exercise rollback**

Disable cron, roll back the application deployment, and confirm database changes are forward-compatible; then restore the accepted deployment.

- [ ] **Step 6: Update README status and commit release evidence references**

Replace “M1 scaffold” with the truthful beta status and distinguish verified live providers from available adapters.

- [ ] **Step 7: Commit**

Commit message: `docs(release): add production beta preflight and runbook`

### Task 5: Reconcile GitHub Projects and Close the Launch Milestone

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-github-delivery-source-of-truth-design.md`
- Modify: `docs/superpowers/plans/2026-09-19-github-delivery-source-of-truth.md`
- Create: GitHub issues for Tasks 1-4, each with the repository’s existing issue contract.
- Update: the repository-linked GitHub Project fields and views.

**Interfaces:**
- Produces: a launch milestone whose items map one-to-one to Tasks 1-4 and whose state matches merged code and deployment evidence.
- Consumes: an authenticated GitHub token with repository and `project` scopes.

- [ ] **Step 1: Re-authenticate GitHub CLI with Projects access**

Run: `gh auth login -h github.com`, then confirm `gh auth status` and a read-only `gh project list --owner sodown4thecause` succeed. This is a user handoff at authentication; do not claim success without the callback and live query.

- [ ] **Step 2: Audit all project items against issue and PR truth**

Correct stale `blocked`, Stage, dependency, PR, and ownership fields for closed issues #11-#19. Keep #20 blocked/post-launch.

- [ ] **Step 3: Add Tasks 1-4 as agent-ready issues and project items**

Each issue includes outcome, owned paths, dependencies, non-goals, acceptance criteria, exact verification commands, and agent handoff rules.

- [ ] **Step 4: Create a production-beta view and close the launch milestone only after Task 4 evidence exists**

The view must make launch blockers distinct from post-launch experiments.

- [ ] **Step 5: Update the historical delivery docs and commit**

Commit message: `docs(project): reconcile production beta delivery state`

### Task 6: Evaluate Conservative Per-Workspace Learning After Launch

**Files:**
- Create: `lib/learning/types.ts`
- Create: `lib/learning/evidence-gate.ts`
- Create: `lib/learning/derive-preferences.ts`
- Create: `lib/learning/replay.ts`
- Create: `lib/learning/repository.ts`
- Modify: `lib/db/schema.ts`
- Create: the generated Drizzle migration and snapshot.
- Modify: the ranker that owns opportunity ordering after its current call path is confirmed.
- Test: `test/learning-evidence-gate.test.ts`
- Test: `test/learning-replay.test.ts`
- Test: `test/learning-workspace-isolation.test.ts`

**Interfaces:**
- Produces: `evaluateLearningEvidence(workspaceId)`, returning an explainable eligible/ineligible decision and observed counts.
- Produces: versioned workspace preference weights derived only from that workspace’s explicit outcomes.
- Produces: an offline baseline-versus-candidate replay report and a guarded ranker integration.
- Consumes: append-only `opportunity_outcome` events from real use; no social content becomes training data.

- [ ] **Step 1: Define the evidence threshold from observed beta data**

Document the minimum judged outcomes, acted-on outcomes, observation duration, and replay sample size in issue #20 before implementation. The threshold must be per workspace and high enough that a single user action cannot materially swing weights.

- [ ] **Step 2: Add failing gate, isolation, determinism, and rollback tests**

Assert no ranking change below threshold, no cross-workspace feature reads, identical baseline order when disabled, version-pinned repeatability, and instant rollback to baseline.

- [ ] **Step 3: Implement preference derivation and versioned persistence**

Allow bounded weights for rejected topics and repeatedly acted-on sources/intents; store the evidence summary and explanation with each version.

- [ ] **Step 4: Build offline replay and require an explicit promotion decision**

Compare baseline and candidate on held-out chronological outcomes. Do not auto-enable a winning candidate; publish the report for review.

- [ ] **Step 5: Integrate behind a workspace-scoped feature flag and run the full verification shield**

The default remains baseline. The flag selects a specific approved weight version and rollback removes its effect immediately.

- [ ] **Step 6: Update and close issue #20 only with replay evidence**

If the threshold is not met or candidate performance is inconclusive, leave learning disabled and close the evaluation as “no launch” only if the issue’s acceptance criteria and evidence support that conclusion.

- [ ] **Step 7: Commit**

Commit message: `feat(learning): add guarded workspace replay evaluation`

## Recommended Delivery Order

1. Tasks 1 and 2 establish trustworthy behavior and prove the product journey.
2. Task 3 makes scheduled production behavior observable.
3. Task 4 deploys and validates the beta end to end.
4. Task 5 makes GitHub Projects match reality and closes the launch milestone.
5. Operate the beta and collect real outcomes.
6. Task 6 evaluates issue #20 without holding launch hostage to insufficient evidence.

## Final Acceptance

- [ ] No production path silently inserts fixture documents.
- [ ] Cross-workspace authorization tests and the complete browser journey pass.
- [ ] Scheduled sweeps leave sanitized, queryable receipts and survive partial provider failure.
- [ ] A deployed workspace completes the full loop using real provider data.
- [ ] README, runbook, issues, pull requests, and GitHub Project state agree with the deployed reality.
- [ ] Issue #20 remains disabled until its documented evidence gate and offline replay criteria are satisfied.
