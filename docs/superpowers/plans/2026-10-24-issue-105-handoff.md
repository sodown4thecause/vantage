# Issue #105 handoff

## Scope and plan

Use a fresh worktree from latest main; preserve the original dirty checkout.
Replace source diagnostics with plain-English coverage, restrict diagnostic disclosures and `/review` to existing admins, and use the existing Polar checkout from settings without changing billing logic.
Add tests for coverage copy, admin/workspace boundaries, checkout products and cancellation dates. Run lint, typecheck, all Vitest tests and build, then inspect the UI before one PR. Never merge or deploy.

## Preserved implementation

- Worktree: `C:\Users\install\workspace\vantage-issue-105`
- Branch: `fix/sources-review-plan`, based on `origin/main` at `4469e45`.
- Checkpoint scope: `app/settings/sources/page.tsx`, `lib/sources/coverage-copy.ts`, `app/review/page.tsx`, `app/settings/plan/page.tsx`, `app/settings/plan/subscription-controls.tsx`, `test/settings-coverage-plan.test.tsx`, and this handoff.
- Sources show one coverage sentence per source; diagnostic data is rendered only in an admin's closed Details disclosure. Removed the Sources footer's review link.
- Retained `/review`: repository search found its Sources link, private-path metadata and an existing error-disclosure contract test. Added the existing `requireAdmin()` before all workspace/queue reads, retaining workspace ownership checks.
- Settings offers both existing Polar products via POST to `/api/billing/checkout`. Subscription display reads only the authorised owner's local subscription rows and displays a future cancellation date when all live Pro subscriptions are ending.
- No migration, billing/auth implementation change, Next version change, Worker configuration change, production deployment, secret change or paid provider call.

## Preservation-only checkpoint

Liam subsequently authorised preserving the blocked work through Captain VANT-22. This is a WIP checkpoint on the existing issue branch, not an implementation restart or a claim that the work is ready. Keep #105 blocked; no PR, merge, force push or production deployment is authorised by this preservation request.

Before staging anything, all seven scoped files were copied outside the source tree to `C:\Users\install\workspace-preserved\vantage-issue-105-2026-10-24-7pp8Xi`. Its `manifest.json` records each file's byte size and SHA-256; all seven copies were compared with their source files and verified. Secrets, credentials, dependencies, generated build output, caches and files outside this issue's scope were excluded. The initial process listing showed no process command referring to this worktree. A second snapshot after this handoff update preserves the final checkpoint contents; its path and remote commit verification are reported to VANT-22 separately.

## Evidence and blocker

- Frozen-lockfile install succeeded with pnpm 11.5.0.
- Targeted Vitest run passed: 1 file, 24 tests (`test/settings-coverage-plan.test.tsx`).
- Full lint/typecheck/test/build command did not return a result. Cancellation reported no registered process and could not confirm termination; do not treat it as passed.
- Earlier targeted attempts ran before dependency installation finished; the final targeted run passed after installation.
- Browser tool has no attached Chrome runtime. Local rendered fixture HTML was generated using mocked test data under `C:\Users\install\.capy\work\issue-105-preview`; this is not a live authenticated acceptance test.
- A headless Chromium check was attempted separately. Only claim its result if its log confirms it. No checkout was submitted.
- No PR: required full-suite and build verification is incomplete. Following Pickup step 3, mark #105 blocked and stop without picking another issue.

## Resume

Inspect `git diff` in the worktree, rerun `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then inspect the actual authenticated settings pages and `/review` boundary. Check subscription cancellation edge cases and zero/sample-data coverage copy. Open one PR beginning `Closes #105` only after verification, reporting no migration and any remaining limitations. No merge or production deployment is authorised.
