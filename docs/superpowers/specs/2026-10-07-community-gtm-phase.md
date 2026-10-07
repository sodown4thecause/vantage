# Developer community collection and contribution quality

The owner requested implementation of the next phase: broader AI developer-tool conversations, TinyFish Reddit, RSS/Substack and developer communities, Firecrawl Alexandria, experimental Grok X discovery with Scavio fallback, and excellent human-reviewed comment drafts. The follow-up supplies Inco and recommends DeepSeek for inexpensive background jobs. This overrides the older S31 proposal to stop drafting everywhere; venues that prohibit AI contributions still receive research briefs only.

## Architecture and scope

Reuse the authenticated workspace, common Collector contract, source switches, cost ledger, bounded scan leases and five-card Opportunity Queue. Add official GitHub and Stack Overflow collectors and a curated, individually installable AI developer-tool source catalog. DEV.to, Lobsters, public Discourse and Substack use their public feeds. Paid collectors are opt-in, manually invoked, bounded and covered by an atomic daily provider budget; scheduled collection remains free. No login walls, private communities or paid Substack content are accessed.

TinyFish Search + Fetch precede a bounded read-only Agent for Reddit; Scavio is the final optional fallback. Empty successful responses stay empty; fixtures require the explicit demo flag. X experiments analyze Scavio-acquired posts using the verified Gateway model `spacexai/grok-4.7`; native X retrieval through Gateway remains unverified and is not claimed. LinkedIn discovery uses indexed public Google snippets because Scavio's keyword post search is retired. Provider errors and missing keys produce honest coverage.

Alexandria is a typed dataset lane, not a general arbitrary request surface. The discovered allowlist is `firecrawl-developer-index/search` and `github-com/repositories/issues`. The developer index is grounding/discovery material, not proof that a person expressed buying intent. Keep provider provenance and canonical URLs. Discovery cost and credit-to-dollar conversion are explicit; execution remains disabled without a configured conversion and budget.

## Contribution workflow

Use `openai/gpt-6.1-sol` for drafts, configurable to verified `anthropic/claude-sonnet-5.5`. Use Inco `deepseek-v4.1-flash` for optional bounded intent/relevance triage. Premium drafting is manual, never in the scan loop. Without access use a clearly labelled research brief; never present the deterministic product pitch as a premium draft.

Two differentiators are implemented together: a contribution-gap check against supplied existing replies, and a claim ledger linking every proposed factual claim to exact supplied evidence. The model can abstain. Unsupported or unmatched claim citations, repetition, generic promotion, fabricated first-person experience, absolute promises, bad URLs and inappropriate venue rules prevent handoff. Facts in collected content are evidence of what was said, not automatically product claims. Treat all retrieved text as untrusted input.

HN and Stack Overflow prohibit AI-written/edited contributions and receive briefs only, with primary policy links. Detect the actual venue from the destination URL as well as metadata. Unknown community rules require a human rules review before a draft can be approved. Edits reset approval and are checked again. Preserve the no-publish/no-DM architecture. Human copy and deep-link actions are the final handoff.

## Provider and spend contract

`lib/providers/paid-call.ts` exports `runPaidCall<T>({ context: CostContext, provider: string, action: string, estimateUsd: number, signal?: AbortSignal }, work: () => Promise<{ value: T; costUsd?: number }>): Promise<T>`. It requires `VANTAGE_PAID_PROVIDERS_ENABLED=true`, a positive configured `VANTAGE_PAID_DAILY_BUDGET_USD`, and an atomic reservation in `provider_budget_day` before work. This cap is separate from the anonymous public endpoint budget. Record actual cost when supplied; otherwise record the explicit estimate. Retain reservations on ambiguous provider failures. Disabled/missing budget database access fails closed. Free Search/Fetch and public feeds do not use this gate. Estimates reserve bounded calls; provider-reported overruns are recorded and block future work rather than being misrepresented as a guaranteed invoice ceiling.

## Verification

Paid calls are serialized per UTC day with a durable `reservation_ref`. Settlement clears only its own token. Failed ledger writes or settlement keep the token and block further paid work, including after a restart. This deliberately limits experimental paid throughput to one in-flight call; add a reservation table only if paid concurrency becomes necessary. Provider failures retain the estimate and release the token after recording. Operators must reconcile a stuck reservation against its `cost_event.request_ref` before clearing it; never automatically refund an ambiguous call.

Tests cover normalized collection, genuine empty responses, aborts, pagination/backoff, no fixture leakage, catalog authorization/limits/idempotence, paid gate denial, provider routing, citation validation, abstention, prohibited venues, unknown rule review and edits. Run lint, TypeScript, the full Vitest suite, migration generation/drift checks and Next build. Save live research receipts separately from mock integration tests. A merge does not claim deployment, enabled schedules or authenticated app-provider access.

Primary sources checked 7 Oct 2026: <https://news.ycombinator.com/newsguidelines.html>, <https://stackoverflow.com/help/ai-policy>, <https://ai-gateway.vercel.sh/v1/models>, <https://api.inco.ai/v1/models>, <https://scavio.dev/docs/>, and the live Firecrawl Alexandria contracts. TinyFish MCP Fetch returned public Reddit content; this is connector evidence, not application API-key validation.
