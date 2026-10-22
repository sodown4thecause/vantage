# Agent guardrails

Two guardrails apply to every coding agent and every task in this repo.

## 1. Mikk — deterministic codebase map (MCP server: `mikk`)

Mikk builds an AST map of the codebase with SHA-256-addressed nodes (function → file → module → root) and an architecture contract in `mikk.json`.

Per task:

- Start: call `mikk_get_session_context`.
- Plan: call `mikk_change_plan` (or `mikk_scope_check`) with the task, and only touch the files it returns. If you need to go beyond that scope, stop and say why before editing. (These two calls are not yet exposed by the installed server; fall back to `mikk_query_context` / `mikk_get_project_overview` for planning and gate edits with `mikk_validate_edit`.)
- Before editing any exported or shared function: call `mikk_before_edit` and check the blast radius with `mikk_impact_analysis` or `mikk_find_usages`.
- Respect `mikk_get_constraints`. Never violate a constraint or ADR in `mikk.json` to finish a task.
- After editing: run `mikk analyze`, then `mikk_git_diff_impact` (or `mikk_get_changes`) to confirm only the intended symbols changed.
- Known limit: Mikk does not parse Next.js file-system routes — check `app/` routes manually.

`mikk.json` (the contract) is committed. Generated Mikk artifacts — `mikk.lock.json`, `.mikk/` and `.mikkignore` — stay local-only, so run `mikk analyze` after a fresh clone. One constraint was deliberately NOT added: `module:opportunities cannot import module:plans` — `buildOpportunities()` in `lib/opportunities/run.ts` legitimately calls `consume()`/`release()` in `lib/plans/limits.ts` for plan metering. Do not re-add that constraint blindly.

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
