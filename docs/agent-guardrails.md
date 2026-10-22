# Agent guardrails

Two guardrails apply to every coding agent and every task in this repo.

## 1. Mikk — deterministic codebase map (MCP server: `mikk`)

Mikk builds an AST map of the codebase with SHA-256-addressed nodes (function → file → module → root) and an architecture contract in `mikk.json`.

Per task:

- Start: call `mikk_get_session_context`.
- Plan: call `mikk_change_plan` (or `mikk_scope_check`) with the task, and only touch the files it returns. If you need to go beyond that scope, stop and say why before editing. (These two calls are not yet exposed by the installed server; fall back to `mikk_query_context` / `mikk_get_project_overview` for planning and gate edits with `mikk_validate_edit`.)
- Before editing any exported or shared function: call `mikk_before_edit` and check the blast radius with `mikk_impact_analysis` or `mikk_find_usages`.
- Respect `mikk_get_constraints`. Never violate a constraint or ADR in `mikk.json` to finish a task.
- After editing: run `mikk analyze`, then restore the pointer with `git checkout -- claude.md`, then `mikk_git_diff_impact` (or `mikk_get_changes`) to confirm only the intended symbols changed. `analyze` always overwrites `claude.md` with the full generated block (cli@2.1.5 has no option to skip it) and rewrites the Mikk context block in `AGENTS.md`; that block is regenerated locally and is not committed.
- Known limit: Mikk does not parse Next.js file-system routes — check `app/` routes manually.

Tracked: `mikk.json` (the contract — its 17 module-boundary constraints live under `declared.constraints`) and the one-line `claude.md` pointer. Local-only: all generated output — `mikk.lock.json`, `.mikk/`, `.mikkignore`, `.clinerules` and the Mikk context block in `AGENTS.md` — so run `mikk analyze` after a fresh clone and never commit the block. One constraint was deliberately NOT added: `module:opportunities cannot import module:plans` — `buildOpportunities()` in `lib/opportunities/run.ts` legitimately calls `consume()`/`release()` in `lib/plans/limits.ts` for plan metering. Do not re-add that constraint blindly.

Published `@getmikk/mcp-server` releases cannot read a `mikk.lock.json` written by cli@2.x — every published bundle (1.10.1 through 2.0.0, frozen since 2026-03-28) still carries the pre-relax 8-value `contextFiles.type` enum and rejects the lock with `Invalid mikk.lock.json structure`. Until upstream rebuilds the server bundle, use CLI fallbacks — `mikk contract show-boundaries` / `mikk contract validate`, `mikk context impact` / `mikk context query`, and `mikk search` — for all lock-reading workflow steps; the cli@2.1.5 builtin `mikk mcp` is not a revival path (it spawns that same frozen bundle and fails identically, verified 2026-10-22). This workspace's local `opencode.json` additionally points the `mikk` MCP server at a locally patched copy of the 2.0.0 bundle (`C:\Users\install\.opencode-mikk\mikk-mcp-patched.cjs`) whose lock-reader accepts cli@2.x locks — published transports still fail exactly as described above.

## 2. ScopeGuard — diff-vs-task audit (CLI via npx)

ScopeGuard compares the git diff against the task description and labels each hunk `in-scope`, `adjacent`, or `corruption`. Scores come from keyword and path overlap — name files and functions in the task text.

Run before calling a task done:

```sh
git diff | npx -y -p @phoenixaihub/scope-guard scopeguard check -t "<the exact to-do>" --strict
```

- Any `corruption` hunk: revert it, or justify it in the summary.
- `adjacent` hunks (imports, types, tests) are fine when needed — list them.

## 3. Definition of done

- Mikk boundary check passes: no constraint violations. Exit code 1 from `mikk ci` is currently caused ONLY by 13 pre-existing inferred-module dependency cycles (cron↔db, db↔plans, …) — treat those as report-only; a NEW cycle or any constraint violation is a failure.
- ScopeGuard passes with `--strict`.
- Build and tests pass.
- Report the Mikk change summary and the ScopeGuard verdict in the final message.

## 4. Durable tool configuration

`mikk analyze` regenerates the lock file, `claude.md` and the Mikk context block, so the settings that must survive a regeneration live in tracked files:

- `mikk.json` — the architecture contract. Top-level keys are `version`, `project`, `declared`, `overwrite` and `policies`. The 17 module-boundary constraints live under `declared.constraints` — that is the array `mikk contract validate` and the boundary checker read. `policies` carries risk and impact settings (`maxRiskScore`, `maxImpactNodes`, `protectedModules`, `enforceStrictBoundaries`, `requireReasoningForCritical`) and no constraints.
- `.mikkrc` — Mikk's `ignorePatterns`. It keeps local secret env files (`.env.local` and friends) and duplicated `package.json`, `tsconfig.json` and `next.config.ts` out of the inlined context.
- `package.json` — the `pkgmgr` script (`pnpm --version`) is inert and is never run by the build. It exists only because cli@2.1.5 picks the package manager by scanning script values for the token `pnpm `; without it the generated `<commands>` block says `npm run` instead of `pnpm`.
- `claude.md` — a one-line pointer to `AGENTS.md` and this file. `mikk analyze` overwrites it with a generated copy; restore it with `git checkout -- claude.md`.
- `AGENTS.md` — the hand-written region and the `nextjs-agent-rules` block are committed; the Mikk context block between the Mikk markers is regenerated locally and is not committed, because its HTTP-route row order is not stable between runs.
