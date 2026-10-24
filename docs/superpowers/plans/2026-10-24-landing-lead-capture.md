# Issue 104: landing and lead capture

Worktree: `C:\Users\install\.capy\worktrees\vantage-issue-104`.
Branch: `feat/landing-lead-capture`, based on latest main `4469e45`.

## Plan

1. Restore the old tour's product-description/source-selection interaction in the hero using `pickForumDomains`. It is a local coverage preview, not a live scan.
2. Update mission, replacement tiles, three-step workflow, closing and home metadata. Label unshipped capabilities honestly. Keep the existing sign-in and workspace creation behaviour.
3. Capture email and product description in a dedicated public lead table. This is intentionally an unauthenticated marketing record, not a workspace opportunity. Expose no read/update endpoint or workspace identifier. Reuse the public Turnstile/rate-limit guard, validate input, deduplicate emails, return generic errors, and send no email or provider discovery requests.
4. Remove the fictional product name from the tour without changing its sample-only boundary.
5. Generate an additive migration and snapshot; check latest-main numbering and open PR collisions before opening the one PR.
6. Verify route validation, guard-before-write, duplicate handling and truthful landing copy with Vitest, then run lint, typecheck, full tests and build. Inspect desktop and mobile rendering with a real browser. Do not merge, deploy or alter secrets.

## Claims audit

SEO research tools exist, but connected Search Console and ongoing rankings reporting are not shipped. AI search research tools exist, but ongoing citation tracking is not shipped. Mark both broad replacement tiles Preview and explain their limits. Link building and content/social are Coming soon. The tour is sample data. The lead form stores interest only; delivery of three conversations is Coming soon and no email is sent.

## Blocked handoff

- `pnpm install --frozen-lockfile` completed successfully.
- Generated `0031_deep_kinsey_walden.sql`, its snapshot and journal entry. The migration has not been applied, and the number still needs checking against latest main/open PRs before publishing.
- Targeted Vitest run: 3 files and 15 tests passed (`public-leads`, `landing`, `tour-workspace`). The later hero inline Preview/Coming soon labels have not been rerun through verification.
- `git diff --check` passed.
- Full lint/typecheck/test/build pipeline did not return results. A separate focused eslint run timed out after 305 seconds. No full-suite/build pass is claimed.
- Browser tool reports no Chrome runtime attached. Installed agent-browser could not connect (Windows error 10060); its diagnostic command and the Playwright CLI fallback both timed out. No visual verification or screenshot is available.
- Remaining registered verification/preview operations were cancelled; the machine could not confirm process termination. Do not assume the local preview has stopped.
- No commits, push, PR, deployment, database writes or secret changes. Changes remain in this worktree. A cheap read-only subagent audited claims and reviewed the implementation.
- Per issue Pickup step 3, mark #104 blocked and stop. Resume only after the local verification environment is working. Live Turnstile/database capture still needs configured staging verification; do not substitute production credentials.

## Preservation checkpoint

At Liam's explicit preservation-only request relayed through Captain VANT-22, the draft is being checkpointed on its existing branch. This does not restart implementation, clear the blocked status, establish readiness, or authorise a PR, merge or deployment.

- Before this handoff update, all 15 dirty files were copied outside the source tree to `C:\Users\install\.capy\work\preservation\vantage-issue-104-checkpoint\files`. `manifest.json` records byte counts and SHA-256 hashes, verified against the copy and stable source bytes. `tracked.patch` records the tracked diff from original base `4469e4523ba9eb48f70d0f090e3a707d47e0d0a0`. Ignored secrets, credentials, dependencies and build caches were excluded.
- The live-process check found no matching Node/Bun/pnpm/Git/Next command lines containing this worktree path. This is a scoped observation, not a guarantee about unrelated processes.
- Captain VANT-22 reports that migration `0031` is reserved by PR #96. Preserve the generated draft intact here; it must not be applied or treated as ready. On resumption, inspect latest main and #96's state, integrate the appropriate base and regenerate using Drizzle with the next free number. Do not hand-edit or rename generated SQL/snapshots to resolve the collision.
- Historical verification remains limited to 15 targeted tests before the final inline hero labels. Full lint/typecheck/tests/build, desktop/mobile visuals and staging Turnstile/database capture remain unverified. No checks are rerun as part of preservation.
- Resume by reading this handoff and the issue, resolving the migration/base prerequisite, restoring the verification environment, rerunning all required gates and checking current issue rules before any PR.
