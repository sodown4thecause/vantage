# AI workspace implementation baseline

26 October 2026. Existing isolated worktree: `C:/Users/install/.codex/worktrees/1284/vantage`; feature branch `codex/ai-workspace`, current-main base `dd30de3`.

Approved design/plans are preserved. The shared primary checkout was not changed. Current main includes the refreshed site in PR #141; keep its visual system.

- Node 25.7.0; pnpm 11.5.0; `pnpm install --frozen-lockfile` completed without lockfile changes.
- Existing Node Worker suite: 37/37 passed.
- Lint: 0 errors, 10 existing warnings. Typecheck: passed.
- Broad initial Vitest run: 1897 passed, 1 failed, 1 skipped. It included a newly added intentional RED regression during root-cause investigation, so it is not a pristine old-main run. The failed case was TinyFish search preview retention on page-fetch failure; it was independently fixed and passed the implementer's focused tests afterwards. A final broad run is still required.
- First fix commit `daec049`: partial-topic cursor preservation and optional TinyFish page-fetch failure retention. Focused 121 tests across 9 files pass; independent task review found no actionable code defects.
- Production build/Worker bundle and final tests: pending. Logs and per-task reports live in the ignored plan-specific SDD workspace.

PR #140 remains draft/unmerged. Do not infer production browser/cron repairs from green CI. PR #136 still has reported review concerns; its enrichment/trend branch is not assumed available. Active Sources/discovery/observability issues remain separate owners' work and must not be overwritten.

This shell/worktree has no database/auth/provider/Cloudflare credentials. No staging scan, actual provider cost, deployed resources, migrations or production behaviour was verified. Live acceptance is an explicit unmet gate. No secrets were printed and no provider spend, production deployment or migration was performed.
