# Content workspace plan

## Goal

Make Content an AI-first writing workspace, reusing the app’s existing Reason-like shell while keeping all writing, editing and approval in Vantage. Vantage must never publish, schedule, comment, vote, email or otherwise act on a user’s behalf. Work stays in the Content surface, its agent/tools, and its generative cards; do not edit GTM, SEO/GEO, `lib/agents/discovery`, or `lib/agents/review` files. Source-data access must go through existing server functions exposed as typed tools; missing contracts get typed stubs and a follow-up note.

## Manual assumptions (Superpowers skill not installed)

- `authorizeWorkspace(workspaceId)` is the boundary for every read and write; all persisted rows are explicitly workspace-scoped and workspace deletion cascades.
- Content conversations and drafts are separate from SEO/GTM conversation storage, so lane semantics and data do not leak between features.
- AI SDK 7 and `@ai-sdk/react` already present are the only AI SDK dependencies; use the existing Vercel AI Gateway route and meter all model/tool calls through `runPaidCall` plus the existing cost ledger. Do not add vendors or call live providers in unit tests.
- A content turn is resumable from persisted user/assistant events and draft state; stop is client cancellation, retry replays a failed user turn safely, and resume reloads persisted history. Do not repeat a paid call on retry without a new, metered attempt.
- Draft generation is private and non-publishing. Even when a future scheduling option is described, it may only mention open-source pendpost; no tool can publish or schedule.
- Use an additive migration with the next free number (currently 0034), generate the SQL and snapshot, and do not apply it.
- Preserve Australian English in UI and generated defaults. Use static suggested-prompt fallbacks when a workspace has no scan or keyword data.

## Execution loop

Complete each slice in order, one task at a time. Before implementation, add or update a focused Vitest test and run it to observe the intended failure; implement the smallest change; refactor only after it passes. On failures, trace the root cause before changing code. Review `git diff` and the lane boundary after each slice. Before each pull request, run exactly `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm vitest run --pool=forks --maxWorkers=2`; include actual command results and report provider spend (unit tests must use fakes; do not incur live AI Gateway spend). Create a GitHub issue for each slice with `agent:reason` and `in-progress`, then open one PR for that slice with a body beginning `Closes #<issue>`. Never merge, deploy, alter secrets, or apply migrations.

## Content UI direction (reviewed before implementation)

- **Tokens:** paper `#0a0b0b`, sheet `#121514`, raised sheet `#171b19`, ink `#f2f5f3`, muted ridge `#8a9490`, cobalt signal `#7d9bff`; reuse the repository’s existing grotesk UI face and Newsreader only for draft text.
- **Layout:** keep the shared workspace frame and use a left-aligned writing canvas beside a narrow recent-thread rail; the composer stays at the bottom of the canvas. At mobile widths the thread rail moves above the conversation and the composer remains full-width.
- **Principles:** make the draft itself the focal point, keep conversation actions plain and specific, and show that Vantage prepares work for the owner rather than publishing it. Avoid a generic row of identical cards, decorative gradients, unnecessary all-caps labels and copied SEO research chrome.
- **Review:** this direction follows Vantage’s existing dark “night survey” palette and the Content goal (turn an idea into an editable draft), rather than introducing a second visual identity; the familiar shell stays quiet while the writing surface is the one distinctive element.

## Slices

1. **Content agent core** — typed, workspace-scoped thread/draft persistence; next-numbered migration; AI SDK 7 `ToolLoopAgent` in a streaming route, Vercel AI Gateway, `runPaidCall`/cost metering; useChat UI with stop, retry and resume. Add tests for workspace isolation, persistence, tool loop and streaming/error states.
2. **Brand voice** — a short, about-five-question AI interview with optional pasted writing samples; workspace-owned profile loaded for every draft; a metered Content-owned Gateway humanisation pass is enforced before save. Repository search found no existing humaniser implementation on `main` (only roadmap references), so this replaces the requested missing helper without a new vendor dependency. Test interview/profile boundaries and mandatory humanisation.
3. **Draft from sources** — typed Zod tools for existing ranked conversation, keyword and competitor-gap server functions; draft blog outline/full post, X thread, LinkedIn post, Reddit/HN reply, and newsletter section with source links. Add typed stubs plus a PR follow-up if a source contract is absent; never read these datasets outside tool calls.
4. **Generative UI cards** — never render raw tool JSON; editable draft (inline edit, section regenerate, copy, save), outline, evidence and repurpose cards. Test card rendering and actions.
5. **Suggested prompts** — three always-visible prompts from latest scan/current keywords, with static fallback prompts when data is absent. Test both branches.
6. **Content library** — saved drafts lower on the page, statuses `idea` / `draft` / `ready`, format/source filters and Markdown export. Test workspace isolation, filters, status and export.
7. **Polish** — empty/error/loading states, mobile layout, Australian English UI and default draft wording. Verify lint/typecheck/tests and inspect the visible experience at desktop and mobile widths.

## Slice status

- [ ] 1. Content agent core
- [ ] 2. Brand voice
- [ ] 3. Draft from sources
- [ ] 4. Generative UI cards
- [ ] 5. Suggested prompts
- [ ] 6. Content library
- [ ] 7. Polish
