# AI workspace migration: research and delivery review

Reviewed 25 October 2026 (Australia/Sydney). This is a research brief, not an approved design or an implementation plan.

## User direction

The entire workspace becomes an AI chat experience. The GTM agent handles onboarding through conversation, researches the product and competitor websites, recommends keywords and competitors, finds suitable sources, and helps decide which sources to scan. Forms are not the primary interaction. Use subagents when implementing. Additional useful features are welcome.

The original reference to October 2016 is interpreted as October 2026, consistent with the client date; this remains an explicit assumption.

## Evidence and limits

The attached checkout is detached at `33adb58bd8c9964b77c2153216b72b1b1e09437c`, an early snapshot with no current application source. Read-only review used fetched `origin/main` at `1b61bcb` and live GitHub issue/PR metadata through the authenticated CLI. Do not implement on the stale application baseline.

Current main pins `ai` 7.0.143 and `@ai-sdk/react` 4.0.147. The latest official documentation identifies v7 as current. No dependency installation or upgrade was performed, and the latest npm patch was not checked.

No staging journey, account billing, resource provisioning, migrations, or production health was verified. CI statuses below are remote evidence, not locally rerun tests. No PR has been approved, merged, or modified.

## Current experience and migration seams

- `app/workspace/workspace-client.tsx` uses custom state and fetch calls for GTM and the setup interview; it does not use `useChat`.
- `app/api/gtm/chat/route.ts` returns a completed JSON answer and cards. It authorises workspace access, reserves a shared question allowance, loads evidence, and persists a turn.
- `lib/gtm/answer.ts` already uses AI SDK `generateText`, structured output, a paid-call wrapper, and a metered search tool. Its instructions explicitly prohibit executing scans, drafts, or mutations. It is an adviser rather than a workspace operator.
- `lib/onboarding/interview.ts` follows seven deterministic steps: URL, description, audience, competitors, communities, keywords, digest. This is a fixed interview even though it looks like chat.
- `lib/onboarding/derive.ts` already reads a product URL and drafts profile fields. The owner then reviews editable profile fields. Preserve useful extraction and validation while replacing the form-led interaction.
- `app/workspace/page.tsx` restores GTM turns and a separate onboarding interview. A unified conversation needs a deliberate compatibility path for existing history and unfinished setup.

## Issue and PR triage

| Item | Observed state | Effect on this work |
| --- | --- | --- |
| [#139](https://github.com/sodown4thecause/vantage/issues/139) agent-first discovery | Open; brief explicitly depends on runtime fixes | Closest existing slice. Covers proposed profiles, competitors, keywords, source relevance review and post-ingestion feedback. Broader all-chat workspace migration needs additional slices. |
| [#140](https://github.com/sodown4thecause/vantage/pull/140) browser and cron fixes | Draft; application CI and Worker bundle pass | Declared predecessor to #139. Reported fixes need independent code/runtime assessment; green CI alone does not establish production repair. |
| [#136](https://github.com/sodown4thecause/vantage/pull/136), [#99](https://github.com/sodown4thecause/vantage/issues/99) enrichment and trends | PR open; CI passes; Greptile fails at 2/5 | Review reports link-post detection, scan-path coverage, inconsistent weekly windows and cache workspace isolation. Useful later, but not a dependency for the initial conversational foundation. Findings are reviewer reports, not independently reproduced bugs in this review. |
| [#105](https://github.com/sodown4thecause/vantage/issues/105), [#124](https://github.com/sodown4thecause/vantage/pull/124) Sources and plan UI | Issue in progress; PR draft; CI passes | Coordinate source-selection behaviour and avoid rebuilding a primary Sources form contrary to the new direction. |
| [#106](https://github.com/sodown4thecause/vantage/issues/106) source discovery | In progress | Reuse catalogue/discovery work behind agent tools; check live ownership before assigning overlapping implementation. |
| [#103](https://github.com/sodown4thecause/vantage/issues/103), [#112](https://github.com/sodown4thecause/vantage/pull/112) knowledge base | Blocked issue; draft design PR | Keep separate from initial chat migration. Future grounding requires agreed provenance and storage. |
| [#121](https://github.com/sodown4thecause/vantage/issues/121) bounded research executor | Blocked | Potential later research tool; do not expose arbitrary provider calls through the agent. |
| [#120](https://github.com/sodown4thecause/vantage/issues/120) Hyperdrive | Blocked; staging-only scope | Not a prerequisite for AI chat; existing Neon HTTP access remains available. |
| [#108](https://github.com/sodown4thecause/vantage/issues/108) observability | In progress | Coordinate agent traces, tool failures and job progress with existing work. |

The open backlog also includes landing/lead capture (#104/#128), Google Search Console (#102), readiness tracking (#72), and pickup guidance (#111). Other open PRs include dependency updates (#138, #129, #67, #64, #42), staging regression coverage (#94), agent guidance (#91), auth handoff (#89), blog routing (#88), cron mocks (#87), Worker size gate (#86), billing (#84), and lazy provider loading (#83). These were inventoried, not subjected to a full code review. Preserve their ownership and evaluate overlaps before integration.

## Architecture alternatives for discussion

### A. AI SDK 7 chat and tools, existing Cloudflare jobs (recommended)

Use `useChat` and its supported transport for streaming conversation. A server-side `ToolLoopAgent` selects typed, bounded tools. Keep workspace authorisation, paid-call policy, source validation and mutations in server code. Reuse existing Workflows and Queues for durable jobs. Persist conversation parts and job IDs in Neon; retain extracted artefacts in R2 and use the existing retrieval/indexing path where activated.

This changes the workspace interaction model without also replacing the execution infrastructure. Tradeoff: application code still owns durable message storage, concurrency, job progress and approval lifecycle. A chat stream is not a durable job.

### B. AI SDK with Cloudflare Agents / Durable Objects chat orchestration

A candidate when reliable live sessions, multiple simultaneous clients and server push justify an additional stateful runtime. Tradeoff: new bindings, lifecycle, tenancy, storage and migration concerns, plus another SDK. #139 currently excludes the Cloudflare Agents SDK. Choosing this requires explicitly revising that scope and a compatibility spike rather than silently adding it.

## Proposed conversational capabilities

1. Owner supplies a URL. The agent researches bounded product pages, extracts a cited profile, and asks only about material gaps.
2. Discover and research competitor sites. Present positioning, audience, pricing and differentiators with URLs and retrieval dates. Separate verified statements from inferences; unsupported facts stay unknown.
3. Suggest product, category, problem, competitor and buying-intent keywords. Explain why each matters and accept natural-language corrections and exclusions.
4. Propose a source mix based on the audience and research, rather than enabling every available network. Include example results, source relevance, expected volume, scan cadence, availability and estimated cost.
5. Apply the agreed setup through validated server actions. Show actual job progress and evidence-backed results in the conversation. Allow pause, retry and correction without redoing completed work.
6. Detect sources producing repeated irrelevant results. Recommend revised queries, exclusions or source changes, with before/after previews.
7. Make opportunity triage, research, draft refinement, saved work and outcome tracking available as chat tools. Keep useful cards and previews inside chat instead of forcing navigation to forms.

Optional high-value additions: a cited product knowledge record with freshness checks; a preview of how a proposed strategy changes scan coverage/cost; a decision history showing what changed and why; and weekly recommendations informed by recorded outcomes. These are proposals, not accepted scope.

## AI SDK practices to carry into the design

- Verify APIs against the installed v7 package documentation/source before implementation. Search results and general examples can mix major versions.
- Use typed tool inputs/results and a server-side agent loop; stream text, tool status and safe result cards through UI message parts.
- Persist and validate UI messages, including tool results and approval state. Do not trust client-supplied history to authorise a write or claim an action completed.
- Bind confirmation to the exact workspace, proposal/version and action. Enforce permissions again at execution; use idempotency keys so retries cannot duplicate sources, scans or charges.
- Keep model-generated proposals separate from validated mutations. Website text, search results and competitor pages are untrusted evidence, including embedded instructions.
- Meter model and upstream tool calls, bound steps/time/results, settle partial failures and avoid retrying non-idempotent work.
- Decide explicitly between cancellable foreground streams and resumable streams: the SDK documentation warns that ordinary stream abort and resume are incompatible. Durable background job cancellation requires its own server-side state.
- Test real workspace boundaries, retry/approval replay, partial failures, budget exhaustion, hostile page content, reload/history, source quality and Worker streaming behaviour.

## Cloudflare fit and costs

`wrangler.jsonc` already declares browser rendering, Workers AI, Vectorize, R2 artefacts, rate limiting, scan Workflows, embedding Queues with dead letters, cron and observability. Semantic mode is configured as shadow for staging and production; binding presence does not mean full retrieval is activated or healthy.

Reuse Workflows for multi-step research/scan jobs and Queues for independently retryable ingestion/indexing. Use R2 for bounded artefacts; keep tenant metadata and decisions in Neon. Rate-limit chat, cap tool calls and budgets, and trace job/tool outcomes without logging secrets or unredacted customer content.

Do not add Hyperdrive, KV, D1 or Durable Objects solely because the account has Workers Paid. Each needs a demonstrated workload benefit. Workers Paid is not an unlimited bundle: services have their own allowances and usage charges. The reviewed Workflows pricing page explicitly lists step and stored-state billing starting August 2026, relevant to an October design.

Live acceptance must separately verify provisioned resources, environment binding isolation, secrets, CPU/memory/bundle limits, outbound URL protection, preview/staging streaming, dead-letter handling, resource usage and rollback. No Cloudflare account-level verification was performed here.

## Decisions still needed before the design

- Confirm architecture A or B.
- Decide the agent's autonomy after initial strategy agreement: automatically manage sources and keywords within a standing budget, or propose each change for confirmation in chat.
- Agree the first deliverable: conversational foundation and discovery first, then the remaining workspace capabilities as owned slices.

Implementation will use subagents as requested, with exclusive file ownership, dependency gates, and separate review. Do not allocate overlapping source/discovery work before reconciling the active issues.

## Sources

- [AI SDK introduction and current v7 surface](https://ai-sdk.dev/docs/introduction)
- [Building agents](https://ai-sdk.dev/docs/agents/building-agents)
- [Chat transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport)
- [Message persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)
- [Tool use and approval](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)
- [Stopping streams](https://ai-sdk.dev/docs/advanced/stopping-streams)
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/)

The repository-requested ChatGPT advisor consultation was attempted. The browser plugin timed out; a separate browser session reached the GPT-5.6 Sol selector, but preparing the consultation timed out. No advisor answer was obtained or used.
