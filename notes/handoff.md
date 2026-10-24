## 2026-10-22 session handoff (Claude, checkout on docs/agents-md-governance)
- Reviewed PR #92 (fix/auth-otp-stale-session) as a comment review only; author owns the fixes. Main ask: move getAuth() out of the try so config errors aren't swallowed, and add a regression test.
- PR #91 (chore/agents-mikk-remediation): done. 0 behind main, MERGEABLE/CLEAN, CI green. Has .mikkrc, pkgmgr, package-lock.json ignore, git-ls-files repo-walk helper. Type-only test edits dropped (typecheck passes). Not merged.
- PR #94 (test/e2e-bugbash): e2e suite open, CI green. Not merged.
- e2e.prod.config.ts and E2E_PRODBB_* vars gone; extra worktrees removed.
- Local verify on Windows: 1428 pass / 3 fail. 2 fail on clean main too (seo-page.test.ts backslash paths, blog.test.ts CRLF); 1 is a load timeout. Linux CI passes. Worth a small fix branch.
- Risky/leftover: this checkout still has an OLDER uncommitted copy of the e2e suite (tests/, e2e.config.ts, .gitignore/package.json/pnpm-lock.yaml edits). Superseded by #94; deliberately not committed. Discard once confirmed.
- Next: fix branches for the remaining bug-bash list, in the order Liam set (blog 404s first). Propose first, don't code.

## 2026-10-22 — Mikk/AGENTS remediation session (Claude Code)
- Branch chore/agents-mikk-remediation → PR #91, head 7a403c3, rebased on main 639d16c, mergeable/CLEAN, CI green. Not merged.
- Done: AGENTS.md (human-written section, mikk + ScopeGuard in the tool table, CODEOWNERS requirement dropped), wrangler workers_dev (prod false, staging true), mikk.json, claude.md pointer, .mikkrc, pkgmgr, guardrails doc, package-lock.json in .gitignore, git-ls-files test helper.
- Verify on Windows: typecheck and lint 0 errors; tests 1429 passed / 2 failed / 1 skipped. Both failures (blog.test.ts CRLF, seo-page.test.ts backslash paths) also fail on clean main.
- Left: open the upstream Mikk issue (draft in the #91 body); close or reconcile PR #93, which duplicates #91 with the untrusted OpenCode text.
- Risky: `mikk analyze` overwrites claude.md, so run `git checkout -- claude.md` after it. opencode.exe (PID 34564) was still running. The .env.local backup at %TEMP%\env.local.bak still has the prod credentials; delete it.

## Session 98459b2d (2026-10-22, PR #91 remediation + bug-bash fix proposals)
- PR #91 (chore/agents-mikk-remediation): https://github.com/sodown4thecause/vantage/pull/91. I rebased it on main 639d16c (e42874c); session 37642e1f force-pushed that plus 02620b4/7a403c3. My own force-push was blocked, so nothing pushed from me. Not merged.
- Conflict: 02620b4 commits .mikkrc + pkgmgr, which this session was told NOT to commit. Liam must say keep or revert. PR body still needs updating; draft in my scratchpad (pr91-body.md); its "Not included" line is stale on .mikkrc/pkgmgr.
- Verified: Mikk cli@2.1.5 analyze always overwrites claude.md (dist/index.js:26709), so the git checkout fallback stands. artifacts/rss-community-bounds tests pass on main + branch.
- Killed opencode.exe PID 34564 and its patched Mikk MCP servers on Liam's request.
- Proposed (not coded): fix/blog-static-404 (drop dynamicParams=false), fix/pricing-error-lookup (Object.hasOwn), fix/billing-session-first (session before appUrl, 503), fix/workspace-ux-signals, fix/bugbash-p2-p3. Leave providers.tsx, lib/auth/server.ts (PR #92) and products.ts (PR #84) alone.
- Risky: the uncommitted .gitignore/package.json/pnpm-lock/e2e.config.ts/tests/ in this checkout belong to the e2e session; don't commit them from docs/agents-md-governance.

## 2026-10-22 e2e bug-bash session (PR #94)
- Branch test/e2e-bugbash → PR #94 https://github.com/sodown4thecause/vantage/pull/94 (open, not merged; remote head dabfac8). It holds 100 regression tests in tests/e2e/ and 18 bug repros in tests/bugbash/ (tag bugbash, each one fails until its bug is fixed). Staging only.
- Done: staging bug bash; production $0 checkout (sub cancelled, ends Nov 22; workspace deleted); e2e.prod.config.ts deleted; E2E_PRODBB_* already gone from .env.local; vantage-e2e worktree already removed.
- Left: fix proposals await Liam's OK (blog 404 → pricing Object.hasOwn → billing session-before-appUrl → UX signals → P2/P3). Liam to delete Neon Auth users bugbash-prod-10221058@example.test (now) and the +bugbash-prod gmail one (after Nov 22). Fix the Polar product description (FlowIntent copy). Ask before setting staging NEXT_PUBLIC_APP_URL. "Remove source" issue not drafted or posted yet.
- Risky: the e2e files uncommitted in this checkout (docs/agents-md-governance) are duplicates of PR #94. Don't commit them here; discard them once #94 merges.
- Windows-only Vitest failures (blog.test.ts CRLF, seo-page.test.ts path separators) are pre-existing and not from #94.
- Background: I left the e2e MCP server (npx, PIDs 4184/9720) running because Claude Code owns it. I didn't start the next dev :3003 (PIDs 28076/11368, running since 21/10), so I didn't touch it.

## 2026-10-24 issue #108 Sentry + PostHog observability (draft PR #116)
- Branch feat/observability-sentry-posthog (worktree C:\Users\install\workspace\vantage-obs, head 64d6e7d, rebased on main 572b3a9) → draft PR #116 https://github.com/sodown4thecause/vantage/pull/116. CI green (lint/typecheck/test/build + Worker bundle). Not marked ready, not merged. #108 keeps the in-progress label.
- Worker bundle: 4,057.08 → 6,411.74 KiB gzipped (+58%, ~3,828 KiB under the 10 MB limit). Before was a local Windows dry run, after came from CI run 40050276443, so the delta is approximate.
- Trailing slash: skipTrailingSlashRedirect plus one redirect that excludes /lumen/. Verified under `next start` (/pricing/ and /blog/<post>/ 308 to no-slash; /, /api/* unchanged; /lumen/* proxied with no redirect) and pinned in test/next-config-routes.test.ts. NOT verified under OpenNext, so check it on staging after the merge.
- Local `pnpm cf:build` fails on Windows with symlink EPERM on @sentry/server-runtime-injection (Next links it from .next/node_modules). Use CI, WSL or Developer Mode to build.
- #115: pre-existing Windows-only seo-page.test.ts path-separator failure (also fails on clean main). Not from #108.
- Before Sentry/PostHog work, Liam must add: Cloudflare secrets SENTRY_DSN and SENTRY_ENVIRONMENT (staging|production) per env; GitHub secret SENTRY_AUTH_TOKEN; GitHub variables SENTRY_ORG, SENTRY_PROJECT, NEXT_PUBLIC_SENTRY_DSN, NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST. NEXT_PUBLIC_* are build-time only.
- Not done: @posthog/ai (optional); server stack traces may stay bundled until wrangler --upload-source-maps + sentry-cli.
