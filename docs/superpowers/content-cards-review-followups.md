# Slice 4 review follow-ups plan

## Definition of done

- Repurposing a saved, source-backed draft can retain only source links reloaded from that draft in the same authorized workspace; no cross-workspace lookup or unverified citation is accepted.
- Ordinary chat cannot update saved drafts outside the card's structured Save changes action, preventing the stale-editor state; card saves remain exact-text, workspace-scoped updates.
- Applying a section proposal changes only that section's original text range; all bytes outside it, including spacing and indentation, remain unchanged.
- No migration, secret change, deployment, merge, approval, auto-merge, publishing, Slice 5 work, or unrelated PR change occurs.

## Plan

1. **Repurposing citation integrity** (`#163` review thread [4375381991](https://github.com/sodown4thecause/vantage/pull/163#discussion_r4375381991)): add failing tests, pass the original draft ID through a typed, server-validated request, reload it scoped by workspace, and treat only its persisted trailing `Sources:` list as reusable citations. Always persist verified citations in that list, even when also inline, and retain the draft ID across failed/disconnected retries. Keep citations bound to one save and cover workspace boundaries.
2. **Stale draft cards** (`#163` review thread [4375382000](https://github.com/sodown4thecause/vantage/pull/163#discussion_r4375382000)): already addressed on main. `lib/content-agent/agent.ts:76–90` only registers `update_content_draft` when the card supplies a structured `draftUpdate`, so an ordinary chat turn cannot change the persisted draft and leave a stale card.
3. **Section formatting** (`#163` review thread [4375382008](https://github.com/sodown4thecause/vantage/pull/163#discussion_r4375382008)): add a failing regression test with indentation and multiple blank lines in untouched sections, then compute section source ranges and splice only the selected range while retaining the existing stale-section guard.
4. Commit each unaddressed thread's test and fix separately, in the order above. Run focused tests after each, then the requested full lint, TypeScript, Vitest, and Worker test commands. Review the diff and confirm no migration or out-of-scope file changes before opening a draft PR.
