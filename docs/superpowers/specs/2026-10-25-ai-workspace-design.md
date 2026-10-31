# Conversational AI workspace and expert contribution suggestions

Date: 25 October 2026, Australia/Sydney.

Status: design approved by the owner in chat on 25 October 2026 ("great"); implementation plans approved on 26 October 2026 ("Yes"). Implementation is in progress. This does not authorise production deployment or attest that reported scan failures are fixed.

## Intent and accepted direction

Vantage becomes an AI chat workspace. The owner talks with a GTM agent to set up their product, research competitors, choose keywords, decide which sources to scan, investigate opportunities and develop contributions. Forms cease to be the primary workspace workflow. Results, evidence and proposed changes appear within the conversation.

The owner explicitly requires:

- AI-led onboarding and research of the product website and competitor websites.
- Suggested competitors, keywords and relevant sources, with confirmation before changes are applied.
- Reliable Reddit scans and AI relevance checks so unrelated Hacker News posts do not appear as recommended opportunities.
- AI-written draft suggestions that help the user demonstrate real domain expertise through useful contributions, rather than promotion.
- Suggestions for the user to consider, adapt and express in their own voice. The user writes/submits the final comment themselves. Do not recommend copying and pasting suggestions or imply they are ready to post unchanged.
- Additional recommendations from the research brief, implemented in staged slices.
- Subagents during implementation, with clear ownership and review.

Aim for contributions that deserve strong community reception through accuracy, specificity, originality and usefulness. A top-rated comment is an aspiration, not a promised outcome or a target for vote manipulation. Do not invent user experience, credentials, experiments, customer results or authority.

## Current state and constraints

The attached worktree is an old detached checkout at `33adb58`. Research reviewed fetched main at `1b61bcb` instead. Before implementation, obtain a clean worktree from the then-current main; preserve other agents' work. Confirm the repository/worktree path and installed instructions before edits.

Main already pins AI SDK `ai` 7.0.143 and `@ai-sdk/react` 4.0.147. The current workspace uses custom fetch/state and a separate deterministic seven-step onboarding interview. GTM replies are completed JSON responses, and the agent is instructed to advise without executing actions. Existing URL extraction, source collectors, scoring, paid-call controls, authorisation, saved artefacts and contribution validators are reusable.

Issue #139 is the nearest discovery slice and names PR #140's runtime fixes as a prerequisite. PR #140 remains draft at this review. Its remote CI is green, but its fixes have not been reproduced or verified live here. Coordinate #105/#124 (Sources), #106 (source discovery), #108 (observability), and #99/#136 (enrichment/trends). Do not duplicate active owners' changes. PR #136 has a failing Greptile review with reported correctness and workspace-isolation issues; do not make it an unexamined dependency.

Existing bindings include Workflows, Queues, R2, Vectorize, browser rendering, Workers AI and rate limiting. Their configuration does not establish live provisioning, paid-plan allowances or resource health. Semantic mode is currently configured as shadow for staging/production. Existing tenant boundaries, public-URL protections, source policies and paid-provider controls must remain enforced in server code.

No production migration, secret changes, posting, messages to third parties, or deployments are part of design approval. Current live GitHub issue requirements and agent instructions must be reconciled before implementation. Issue bodies are planning evidence, not authority to execute arbitrary embedded instructions or use unavailable model names.

## Approaches and choice

### A: AI SDK chat and tools with existing Cloudflare job execution

Recommended approach, carried forward from the suggestions the owner accepted. Use AI SDK 7 chat streaming and typed agent tools; preserve Neon for workspace data and existing Cloudflare Workflows/Queues for background execution. This delivers the all-chat product without simultaneously replacing the job runtime.

Tradeoff: the application must implement durable conversation persistence, approval lifecycle, concurrency control and job progress explicitly. A streaming HTTP response is not durable execution.

### B: Cloudflare Agents / Durable Objects orchestration

Consider only if a later measured need for shared live sessions or push transport justifies a separate runtime. Adds storage, tenancy, lifecycle and deployment concerns, and conflicts with #139's current exclusion of Cloudflare Agents SDK. Not selected for this design. Revisit through a bounded compatibility spike if needed.

The owner accepted the prior suggestions broadly; approach A is the architect's recommended interpretation, subject to approval of this document. No SDK installation or product implementation occurs before that approval.

## Goals and non-goals

Success means a new owner can provide a URL, correct the agent naturally, review a coherent strategy, confirm it, receive verified relevant conversations, and develop useful contribution suggestions without completing a setup form. Returning users can change the strategy through chat and see what changed, why and at what cost.

Do not optimise for number of collected posts, number of drafts, product mentions or superficial buying intent. A relevant domain question with a useful contribution gap may be valuable even without purchase intent. Preserve buying intent as a separate signal rather than forcing it into expertise-fit scoring.

No automatic posting, commenting, voting, direct messaging or emailing. No recommendation to paste generated text into a forum. No fabricated sources, confidence, engagement counts or scan completion. No requirement to use every Cloudflare service, add a new database, or expose generic unrestricted provider calls to the model.

## Conversation and workspace experience

One primary workspace conversation surface supports onboarding and ongoing work. Multiple saved conversations may remain, all scoped to the same verified workspace. The agent knows the currently confirmed strategy, pending proposals, recent jobs and saved evidence; chat history alone is not the authoritative configuration.

The first turn asks for the product URL or accepts a description when the site cannot be read. The agent reports research progress, drafts its understanding, and asks only about material gaps. It can explain or revise any field in natural language. Do not turn the existing seven form questions into seven mandatory chat questions.

Competitor suggestions include canonical domain, positioning, evidence URLs, retrieved dates and factual uncertainty. Keyword suggestions cover the product's domain, audience problems, category and relevant competitors, each with a reason and exclusion options. No automatic competitor activation from a guessed name.

Source proposals show the specific community/feed/search configuration, relevance evidence and sample threads, proposed queries/exclusions, cadence and cost bounds. Distinguish a community directory, a search result and a verified conversation. The owner can say, for example, "keep the developer communities and exclude hiring posts"; the agent creates a revised proposal rather than silently applying the text as configuration.

After confirmation, a concise applied-change receipt names the changes and any job actually started. Cards show job status, partial coverage, verified results and explanations. Settings, source controls, opportunity actions, saved artefacts, draft development and outcomes become agent tools. Authentication, account consent and checkout remain explicit secure flows; the agent can guide to them without fabricating completion or collecting payment credentials in chat.

All product copy describes suggestions to review and adapt. Remove the existing one-click reply copy/open emphasis from the workspace contribution flow. A neutral source link may open the original thread for reading. Do not prefill a forum comment field or implement a combined copy-and-submit action. Suggested copy: "Use these ideas to write your own response. Check the facts and community rules before you contribute."

## Agent and server responsibilities

Use the installed v7 documentation and source to select exact `useChat`, transport, `ToolLoopAgent`, streaming and approval APIs. Do not copy v5/v6 examples from search results without validation.

The agent chooses among narrowly scoped tools, not arbitrary HTTP, SQL or provider executors. Initial tool categories are:

- Read confirmed profile, strategy, expertise notes, saved evidence and scan health.
- Research an approved public product or competitor domain through existing permitted, budgeted providers.
- Discover and review competitor, keyword and source candidates.
- Propose a strategy change, with a before/after diff and estimated costs.
- Apply a confirmed proposal through existing validated server services.
- Start an approved scan, read progress/results, retry eligible failed work, and request cancellation.
- Read/verify a candidate thread and permitted comments, assess relevance and contribution gaps.
- Produce/revise contribution suggestions, save work and record owner-reported outcomes.

Workspace identity comes from authenticated server state and verified access, never from a model-selected argument alone. Authorise before each tool's reads, writes or upstream calls. Recheck access when applying an old proposal. Models produce typed proposals and evaluations; validated server code performs mutations.

Apply bounded steps, timeouts, provider calls, pages, bytes, candidate counts and costs. Every tool emits safe user-facing status and an auditable result; claims such as "saved" or "scanned" must come from actual server outcomes.

## Confirmation contract

The owner chose propose-and-confirm. Competitors, keywords, sources, exclusions, scan schedules and strategy changes remain pending until explicit approval in chat. Initial confirmation can approve a named batch with its exact diff; it is not standing permission for future strategy revisions.

Each proposal has a server-generated ID, workspace ID, strategy version, exact typed payload, cost/schedule effect, creation/expiry time and status. Confirmation is bound to that ID/version. If natural-language approval is ambiguous, request clarification in the conversation. A model's interpretation of "yes" is insufficient without the server-associated pending proposal and matching actor/workspace.

Use atomic application and idempotency keys; enforce a unique execution per approved proposal. Reject expired, stale, denied or superseded approvals. A changed proposal needs fresh confirmation. Replays, concurrent tabs and retried tool calls must not duplicate sources, jobs or charges. Preserve an audit receipt of actor, changes and result.

Reads and bounded discovery are allowed within a stated research allowance. Starting paid recurring scans needs confirmation of the schedule and cost ceiling. An accepted schedule authorises its runs; changes to that schedule need a new proposal. A one-off scan explicitly requested in chat may execute under that request after server checks, rather than asking twice. Cancelling a job is an explicit action, not an assumption that closing chat cancels it.

## Reliable Reddit scanning

Investigate the reported failures before changing code. Trace one reproducible scan from confirmed source and budget reservation through dispatch, provider selection, discovery, thread retrieval, normalisation, persistence and ranking. Capture structured categories, timestamps, request/job IDs, source IDs and provider status without secrets or private raw bodies.

The existing collector can retain successful earlier topic results as partial when a later topic fails. Preserve that behaviour and test the symmetric cases: first-query failure, all-query failure, mixed success, zero genuine results and cancellation. Existing previews are marked discovery-only; do not relabel a search snippet as a fully read thread.

Provider access, rate limiting, budget exhaustion, empty results, hydration failures and application errors must remain distinguishable. Do not report missing credentials or a denied budget as a healthy zero-result scan. Do not claim a successful fallback without received, validated data. Never substitute unrelated HN threads for missing Reddit results.

Tests must reproduce the identified fault before a fix. Live staging acceptance must exercise actual public Reddit thread discovery and full-context retrieval through the configured permitted providers. If credentials or a provider outage prevent that, document the precise blocked stage; mocked tests alone do not meet Reddit acceptance.

## Relevance and thread verification

Separate source relevance from post relevance. A relevant community can contain unrelated posts. Separate retrieval confidence from domain fit, expertise fit, timeliness, buyer intent and contribution opportunity; one combined score must not hide missing evidence.

Before user-visible recommendation:

1. Validate the canonical platform/thread identity, requested community and cross-provider identity consistency; remove duplicates and profile/wiki/search-page results.
2. Verify full thread text and available recent replies through approved retrieval, with provenance and fetched time. Mark deleted, locked, unavailable, stale or partial context honestly. Unverified snippets remain discovery candidates and are excluded from ready-for-contribution results.
3. Run a bounded AI relevance evaluation against the confirmed product domain, audience, expertise and exclusions. Require a typed decision, reason and evidence references. Reject unrelated matches even when keywords overlap.
4. Check whether a useful contribution is feasible: unresolved question, useful method, tradeoff, diagnostic, correction or example. If existing replies already address it, abstain or identify a supported distinct angle.
5. Validate the evaluator output independently: references must exist, quotes must appear in supplied text, and platform/source identity must match. Malformed or unavailable evaluation cannot become a recommendation.

Use a labelled evaluation set including the owner's unrelated HN examples, relevant Reddit questions, superficially matching keywords, empty/deleted/locked threads, snippets, already-answered discussions and hostile page instructions. Obtain the exact historical examples from stored authorised scan evidence where available; if unavailable, record that limitation and use clearly synthetic regressions without claiming an exact reproduction.

Builder's initial threshold proposal: show a verified recommendation only when relevance passes the calibrated threshold and the evaluator identifies a specific supported contribution opportunity. Tune on a development set and report held-out acceptance, including relevant cases wrongly rejected; never silently set thresholds from model confidence alone. Include the product's adjacent domain questions as positives, not only purchase-intent examples.

Collection may store bounded raw candidates for debugging/review with explicit candidate status. Recommendation gates must run before a candidate reaches the recommended queue or draft generation. Track independent counts for discovered, verified, rejected, recommended and drafted; zero recommendations is a valid outcome.

## Expert contribution suggestions

The owner's aspiration is to earn recognition by helping. A good suggestion directly addresses the thread, offers concrete useful reasoning, respects the audience's level, adds something missing, and grounds claims in verified material. A brief helpful response may outperform a long one; avoid a mandatory word quota.

Maintain optional owner-confirmed expertise notes, practical examples and experience claims with provenance. Product website marketing is not proof that the owner performed an experiment. Do not write "I built/tested/used" unless the owner has supplied and confirmed the relevant fact and its use. Avoid brand insertion, affiliate links, CTAs and repeated templated replies.

Before suggesting a draft, provide thread-specific evidence and a contribution angle; retrieve available replies and community rules with timestamps. If rules/context are unknown, offer research notes and questions instead of treating the draft as ready. Where AI writing is prohibited, provide source research and contribution angles without generated comment prose. HN is currently such a venue; independently recheck policies at acceptance rather than relying on dated code constants.

Where permitted, an AI draft suggestion can include a concise answer, practical steps or a small example, explicit caveats and supporting sources. Check unsupported claims, fabricated expertise, duplication, factual errors, unsolicited promotion and thread fit. Reuse the existing contribution validators, while assessing their limitations: lexical duplicate checks and quote overlap do not establish semantic correctness. Add an independent quality review and meaningful evaluation fixtures.

Every suggestion carries its evidence, the gap it aims to fill and a short explanation of what to verify or personalise. The user can ask for different reasoning or tone. The product must state that these are suggestions to adapt in the user's own words, not paste-ready comments. No posting integration, prefilled forum fields, automatic copy-and-open sequence, rank promises or solicitation of votes.

## Source health feedback and outcomes

After scans, use verified post-level assessments to aggregate source health: coverage, recommendation precision, repetition, missing context, failure rate and cost per useful result. Suggest revised queries, cadence, exclusions, pausing or source removal when evidence warrants it. All configuration changes require confirmation; a noisy source is not silently removed.

Record owner-reported outcomes or observations available through permitted read access, distinguishing these from verified metrics. Useful signals include whether the suggestion helped, whether the final comment received substantive replies, and whether the conversation advanced. Ranking/votes may be tracked when available and timestamped, but do not prove expertise or causation.

Optional accepted suggestions become later slices: cited knowledge records and refresh warnings; strategy coverage/cost previews; a decision history; and weekly recommendations grounded in recorded outcomes. Proactive notifications remain opt-in and do not authorise sending comments or messages to forum participants.

## Persistence, streaming and durable jobs

Persist typed UI messages and safe tool result parts, with server IDs, workspace and conversation ownership, proposal links and job links. Validate stored messages against the installed SDK schemas before reuse. Keep structured authoritative state outside transcript text; load only bounded relevant history and evidence.

Preserve existing conversations, saved artefacts and confirmed profiles through an additive compatibility layer. Resume unfinished interviews through a conversational summary of existing confirmed fields, without losing state or demanding the same answers again. Generate additive migrations with the next available number and matching snapshots; do not hand-edit generated migration metadata.

Foreground chat streams support Stop by forwarding cancellation to model/tool calls where supported. Do not enable the SDK's ordinary resume option alongside this cancellation behaviour without a documented compatible design. Persist completed turns and explicit interrupted state. Durable jobs return a job ID, survive navigation and surface persisted progress after reload; cancellation and retries are server-owned and idempotent. The builder may choose polling or supported stream updates based on the installed stack, without adding a second chat runtime.

## Cloudflare and paid-call policy

Keep existing Workflows for durable scans and multi-step research, Queues for retryable ingestion/indexing, R2 for bounded artefacts, Vectorize for retrieval where activated, and Neon for tenancy/configuration/decisions. Use dead-letter queues and distinguish retryable provider failures from permanent configuration or permission failures.

Preserve the current paid-call ledger and reconcile model, discovery and hydration costs even on malformed results, cancellation and partial failure. Enforce reservations before spend; retry only safe operations within approved limits. #139 proposes a $0.50 initial discovery budget and $0.05 daily review budget; carry these as proposed defaults, expose their scope honestly and reconcile them with existing plan/workspace caps before implementation. Proposal approval is not permission to exceed a budget.

Workers Paid is not an unlimited bundle. Measure calls, CPU, workflow steps/storage, queue delivery, browser usage, artefact storage, embedding/index usage and provider costs. Verify account allowances and actual provisioned resources independently. Add services only for a demonstrated need; Hyperdrive and Cloudflare Agents are not prerequisites.

Apply explicit CPU/time/tool/candidate limits, request rate limits and outbound URL controls, including redirect/private-address handling. Test real OpenNext/Workers streaming, cold-start/bundle size, staging/production isolation, retries and queue DLQs. Observability records safe job/tool outcomes and aggregates rather than full customer prompts, source text or secrets.

## Delivery slices and ownership

1. **Reliability investigation and regressions:** reproduce Reddit failure and HN mismatch, reconcile #140 and existing fixes, establish provider-aware health and baseline evaluation fixtures. Bug fixes may be delivered independently once root cause is proven.
2. **Conversation foundation:** streaming UI, typed agent tools, durable message storage, proposal/confirmation lifecycle and compatibility with existing workspace state. Keep UI, persistence/authorisation and tool execution ownership explicit.
3. **Agent discovery:** product/competitor research, confirmed profile, keyword and source proposals; coordinate #139/#106. Add source quality review before recommendation.
4. **Verified scans and feedback:** full-thread/reply retrieval, post-level relevance gate, truthful partial failures, source-health proposals and cost previews. All scan entry points use the same gates.
5. **Expert suggestion experience:** migrate/reuse drafting with thread context, evidence and quality review; remove copy-and-post emphasis; research-only output for prohibited/unknown venues.
6. **Learning and wider workspace tools:** saved knowledge freshness, decision history, outcome tracking and optional weekly recommendations; bring remaining GTM actions into chat through the same validated tools.

Use subagents for implementation as requested. Each receives an exclusive file/module responsibility, stable input/output contracts and acceptance commands. Tell all implementers that they share a codebase, must preserve others' changes and must adapt to agreed interfaces. Run independent review after integration. Do not dispatch dependent slices as if they were independent, or assign overlapping active issue ownership without coordination.

## Acceptance and release evidence

- URL-only setup can produce a cited proposal and accept natural-language corrections without the primary form flow.
- No competitor/keyword/source/schedule revision applies before its exact proposal is confirmed. Stale/replayed/cross-workspace confirmations fail; duplicate calls cannot duplicate jobs, sources or spend.
- A real staging Reddit scan has evidence of provider discovery, verified thread retrieval and correct result state. Reproduce and fix the actual reported failure if evidence permits; otherwise state the specific unreproduced/live blocker.
- The irrelevant HN regression never enters recommended results or produces a suggestion; relevant adjacent-domain cases remain eligible. No unrelated forum fills an empty Reddit result set.
- Preview-only, unavailable or deleted/locked threads cannot be represented as verified contribution opportunities. Existing replies and provenance are shown honestly.
- Suggestions pass evidence, contribution-gap, domain-fit, originality and community-rule checks; unsupported expertise/promotion is rejected; no useful addition leads to abstention. HN gets research notes/angles, not AI comment prose.
- The user is told to consider/adapt suggestions and write their final contribution themselves. No copy-and-post/prefill flow or automatic posting exists in the migrated experience.
- Reload restores confirmed setup, conversations and background job state. Stop, partial failures, denied spend and provider outages remain distinguishable.
- Run repository-required lint, typecheck, tests, production build, migration drift and Worker bundle/entry checks. Add meaningful tests for tenancy, approval replay, partial retrieval, quality gates and paid-call settlement.
- Verify the complete staging journey in a real browser. Keep CI success, live provider success, resource/migration readiness, reviewer approval and deployment as separate evidence.

Design approval permits writing the implementation plan. It does not skip the known prerequisites, independent review, CI or staging acceptance.

## References

- [Research and PR review](../../reviews/2026-10-25-ai-workspace-review.md)
- [Issue #139](https://github.com/sodown4thecause/vantage/issues/139)
- [Runtime fix PR #140](https://github.com/sodown4thecause/vantage/pull/140)
- [AI SDK current documentation](https://ai-sdk.dev/docs/introduction)
- [Agents](https://ai-sdk.dev/docs/agents/building-agents)
- [Message persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)
- [Tool usage and approval](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)
- [Stream cancellation](https://ai-sdk.dev/docs/advanced/stopping-streams)
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
- [Hacker News guidelines, checked 25 October 2026](https://news.ycombinator.com/newsguidelines.html)
- [Reddiquette, checked 25 October 2026](https://support.reddithelp.com/hc/en-us/articles/205926439-Reddiquette)
