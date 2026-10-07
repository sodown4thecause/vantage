# S51 — `npx vantage init`, Claude Code plugin and skill files

**Track:** Ship as a skill (Idea 4) · **Wave:** 4 · **Size:** L · **Owner:** agent · **Depends on:** S50, S52 · **Unblocks:** S61

## Outcome
One command installs Vantage into the user's agent (Claude Code, Cursor, Codex, Hermes, OpenClaw) and runs the free sources locally with no server or account.

## Scope
- Move to a pnpm workspace: `packages/cli` (`vantage`, bin `vantage`, Node >= 20, zero or minimal dependencies), `packages/core` (shared pure logic extracted from `lib/`: intent ladder, pack schema/validator, source fetchers for HN/GitHub/Stack Overflow/DEV.to/Lobsters/Bluesky), keep the Next app consuming `packages/core` without behaviour change (existing tests must still pass).
- `vantage init`: detects installed agents, writes MCP config and skill files (`SKILL.md` with frontmatter; Claude Code plugin manifest; Cursor rules file; Codex/Hermes/OpenClaw equivalents; verify each tool's current config format from its docs before writing), idempotent, `--dry-run`, `--uninstall`.
- Local mode commands: `vantage scan <repo-or-url>`, `vantage briefs --today` ("find 5 threads I should answer today" returns Reply Briefs; no draft prose), reading `GITHUB_TOKEN` optionally.
  - **Decision (owner):** S05 reserves Reply Briefs (`reply_briefs`) for Pro, but local mode needs no account, so it cannot be entitlement-checked. Options: (a) local briefs are a distinct free feature (the user's own agent and machine do the work, Vantage pays $0, no saved ledger, no shared rules index freshness guarantee); (b) local `briefs` requires `vantage login` and a Pro key checked against the server; (c) ship local mode without `briefs` until decided. Recommendation: (a), and reword S05/S31 gating as "hosted Reply Briefs (saved, rules-checked, ledger) are Pro". Until the owner decides, implement (c): `scan` only, and `briefs` prints that it needs Vantage Pro.
- Publishing: npm package with provenance via CI (human provides `NPM_TOKEN`); license file; README with the "Works with" list.
- Skill content: instructs the agent to call the MCP tools (S50) or local commands, to never post for the user, and to disclose when a venue bans AI text.

## Acceptance criteria
- [ ] `npx` of a local tarball in a clean temp directory installs and runs `scan` against fixtures offline.
- [ ] Config writers tested with temp home directories for each agent; never overwrite user content without a backup.
- [ ] CI builds and tests packages; the Worker bundle size check still passes.
- [ ] Install and first-result time measured (< 2 minutes, record in PR).
