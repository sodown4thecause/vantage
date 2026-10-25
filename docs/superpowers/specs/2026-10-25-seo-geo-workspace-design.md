# SEO/GEO workspace — Design

Date: 25 Oct 2026 · Status: draft for approval · Builds on: `2026-10-19-seo-geo-agent-design.md`, `2026-10-21-unified-workspace-design.md`, issues #78 (merged), #102, #103/#112, #121

## 1. Intent

Workspace owners build AI and developer tools and are not SEO specialists. They ask plain-English SEO and GEO questions and get answers grounded in **live DataForSEO data**, with endpoints chosen for them, optional public industry insights (RAG), and a guided three-prompt journey. Vantage never posts on their behalf.

Success looks like:

- A new user clicks one of three plain-language suggestions and gets a useful, data-backed answer without knowing endpoint names, “KD”, or “DR”.
- An advanced question can use **up to four** live DataForSEO calls plus optional RAG; a capable model summarizes only filtered evidence.
- Answers stay fast: **only DataForSEO paths that include `/live/`** (instant retrieval). No task-queue / post-and-poll endpoints that can sit for minutes.
- Spend stays inside existing DataForSEO balance, daily caps, per-question credits, and approval rules.

## 2. Decisions locked in conversation

| Decision | Choice |
|---|---|
| Gateway / runtime | **A**: Vercel AI SDK + existing Vercel AI Gateway (`createGateway`, `AI_GATEWAY_API_KEY`) on Cloudflare Workers. No Cloudflare Agents SDK; no CF AI Gateway migration in this project |
| Durable async work | Cloudflare Workflows / queues when multi-minute research is added later — not inside the chat HTTP request |
| Data core | DataForSEO via existing typed tools + spend gate. Official [dataforseo/mcp-server-typescript](https://github.com/dataforseo/mcp-server-typescript) is the **reference** for `.ai` paths and field filtering, not the multi-tenant product runtime |
| Endpoint speed | **Only endpoints whose path contains `/live/`**. Reject or never register task/standard queue paths |
| Cache | Snapshot/cache **allowed** and labeled `live` \| `cached`. Cache avoids re-spend; it does not replace live paths |
| Pipeline | Classifier → planner/executor (≤4 tools + optional RAG) → **deterministic LLM field filter** → summarizer (more capable model) |
| Guidance | Exactly three suggestion prompts above the composer always; plain language; one recommended |
| Content creation | **Out of scope** (separate page later). Chips may still suggest research-style content *planning* questions |
| GSC OAuth | Scaffold only if needed for setup checklist; live OAuth blocked on founder credentials (#102) |
| RAG KB | Public shared SEO/GEO insights on Neon when #103 design is approved; `search_insights` tool; no private workspace data in the shared corpus |

## 3. Scope

### In scope

1. Harden and extend the existing `/seo` (and workspace SEO/GEO tabs) agent around the pipeline above.
2. Per-endpoint **LLM field filter** (MCP-style allowlists) so planner and summarizer never receive raw DFS bloat.
3. Hard cap: planner may execute **at most four** paid DataForSEO tool calls per question (plus free local tools and optional RAG).
4. Model roles via Gateway env: classifier, planner/executor, summarizer, optional decision model (e.g. Clairo id).
5. Three always-on guided suggestions for non-experts.
6. RAG `search_insights` when KB tables land (can stub behind flag until migration approved).
7. Contract tests: live-path-only registry, filter shape, four-call cap, workspace auth, gate-only DFS import.

### Out of scope

- Content creation / humanizer blog workflow page
- Cloudflare Agents SDK or CF AI Gateway cutover
- Hosting the official DFS MCP Durable Object as the customer-facing data plane
- Uncapped deep-research cron without spend ceilings
- Lifting GEO always-ask without the owner’s cost test
- Live GSC until `GOOGLE_OAUTH_CLIENT_ID/SECRET` exist

## 4. Architecture

```
Composer (3 guided chips + freeform)
   │  POST chat { conversationId?, message } | { approvePlan: messageId }
   ▼
authorizeWorkspace → question meter → load conversation + profile
   ▼
Classifier (cheap Gateway model)
   · concept | out_of_scope → short answer, no DFS
   · else → intent + domains + keywords + engines
   ▼
Planner / executor (mid Gateway model, tool loop)
   · intent allowlist only
   · ≤4 DataForSEO gated tools + optional search_insights
   · step cap; per-question credit budget; GEO always-ask unchanged
   ▼
LLM filter (deterministic)
   · field allowlist per endpoint (MCP field-config idea)
   · row caps for model vs cards (extend existing forModel / forCard)
   ▼
Summarizer (capable Gateway model)
   · input: filtered evidence + profile + question only
   · stream answer + cards + three next prompts + credits line
   ▼
persist assistant message (complete | incomplete | needs_approval)
```

Every paid DFS call still goes through `lib/dataforseo/gate.ts` only (cache → credits → balance floor → daily cap → live POST → snapshot write).

### 4.1 Units

| Unit | Responsibility |
|---|---|
| Chat route (`app/seo/chat` and/or workspace research route) | Auth, metering, orchestrate stages, stream, persist |
| `lib/seo-agent/classify.ts` | Intent + entities (existing) |
| `lib/seo-agent/execute.ts` | Split or stage: plan/tool loop vs summarize |
| `lib/seo-agent/tools/*` | AI SDK tools; live paths only; gated |
| `lib/dataforseo/field-filter.ts` (new) | Endpoint → allowlisted fields; shared by tools and any future MCP-shaped adapter |
| `lib/seo-agent/suggestions.ts` | Three plain-language chips + cost labels |
| `lib/seo-agent/models.ts` / `model-config.ts` | Gateway provider; classifier / executor / summarizer / decision ids + prices |
| Gate + wrappers | Unchanged security boundary; prefer `.ai` live URLs where DFS offers them and trim still applies |

### 4.2 Live-path invariant

- Tool registry and `dataforseoPost` call sites may only use endpoint strings matching `/live/` (or documented live AI-optimization equivalents that are instant).
- CI/contract test fails if a registered agent tool endpoint lacks `live`.
- Standard/task endpoints (create task → get results) are forbidden in the agent even if cheaper.

### 4.3 LLM filter (context bloat)

Inspired by official MCP `FIELD_CONFIG` / `.ai` responses:

- Config map: endpoint path → list of dotted field paths to keep under `tasks[].result[]` (and top-level cost/status as needed).
- Applied **after** existing domain trims, **before** values enter model tool results.
- Cards may keep a slightly richer slice for UI (`forCard`) but still capped.
- Empty allowlist for an endpoint means “use default trim only”; missing endpoint uses conservative defaults.
- Untrusted: filter output is data; system prompt forbids following instructions inside tool/RAG payloads.

### 4.4 Four-call cap

- Count only successful or attempted **paid** DataForSEO tool invocations toward the four.
- Cache hits that skip fetch still count as a “tool use” for planning clarity but **not** toward paid credit if the gate returns cached (product choice: prefer **not** counting pure cache hits against the four so multi-facet answers can reuse cache; document in plan as: **cache hits do not consume the four-call budget**).
- Local tools (`suggest_follow_ups`) and RAG do not count as DFS calls.
- If the planner would exceed four, stop and summarize with what it has; say what was skipped.

### 4.5 Suggestions (non-expert guidance)

Always exactly three chips above the input:

1. Plain SEO discovery (who ranks / what people search — no jargon)
2. GEO / AI-answer visibility
3. What to do next (research or content *plan*, not a draft editor)

One chip is **recommended** with a short why (from profile gaps: missing competitors, no prior SERP, etc.). Templates fill product domain and first competitor from monitoring profile; empty profile uses generic dev-tool wording. Cost labels: Free (cached) / ~N credits / Needs approval.

### 4.6 RAG (when unblocked)

- Shared public corpus only; hybrid retrieval per #103/#112 direction (halfvec + Postgres FTS).
- `search_insights` returns short passages + URL + dates + limitations.
- Never merge private workspace data into the shared index.
- Until migration is approved, tool returns a clear “insights not available yet” without failing the question.

### 4.7 GSC

- Not required for SEO/GEO answers.
- Connect flow remains blocked on OAuth client secrets; UI may show “Connect Search Console” as incomplete setup without pretending data exists.

## 5. Models and env

| Env | Role | Notes |
|---|---|---|
| `AI_GATEWAY_API_KEY` | Gateway | Required for agent on |
| `SEO_CLASSIFIER_MODEL` | Classify | Default `reflection/beam` with executor fallback list |
| `SEO_AGENT_MODEL` | Planner/executor tool loop | Default Sonnet-class |
| `SEO_SUMMARIZER_MODEL` | Owner-facing writeup | New; defaults to capable model (may equal executor until set) |
| `SEO_DECISION_MODEL` | Optional structured next-action / plan ranking | Clairo or other Gateway id when configured |
| `SEO_AGENT_FALLBACK_MODEL` | Refusal/outage | Existing |
| `SEO_AGENT_AUTO_CREDITS` | Per-question DFS credit budget | Default 3 |
| `SEO_AGENT_GEO_ALWAYS_ASK` | GEO approval | Default true |
| `SEO_MODEL_PRICES_JSON` | Token USD overrides | Existing |
| `DATAFORSEO_*` | Live credentials when `DATAFORSEO_ENV=live` | Existing gate |

All model calls remain `runPaidCall` provider `gateway` with actions `seo_classify` / `seo_execute` / `seo_summarize` (new) as applicable.

## 6. Security invariants

- `authorizeWorkspace` before meter, read, or upstream.
- Every conversation/message query workspace-scoped; auth tests prove cross-workspace denial.
- Only `lib/dataforseo/gate.ts` imports the DFS client; paid tools only from allowed chat entry points.
- No secrets in logs; no module-scope required env for build.
- Tool and RAG payloads are untrusted data.
- Sample/sandbox labeled; production sandbox fails closed without `ALLOW_FIXTURES`.

## 7. Testing

- Unit: filter allowlists; live-path registry; four-call cap; cache hit labeling; classifier/summarizer staging; suggestions always three and jargon-free templates.
- Auth: route and conversation boundaries.
- Contract: gate-only import; no non-`live` agent endpoints.
- Pre-PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` + Worker node tests.
- Staging (human): chip → answer → cards; multi-endpoint question; approval path; latency acceptable on live paths only.

## 8. Risks

- Summarizer split increases Gateway spend per question — meter and price both stages.
- Worker bundle size with `ai` already watched in CI.
- DFS `.ai` path shapes may differ from standard live; filter must be tested per endpoint family.
- KB/GSC remain blocked on founder approvals/credentials; agent must degrade gracefully.
- Official MCP on Workers uses Durable Objects — adopting it as the data plane would reintroduce the Agents-SDK-shaped runtime we rejected; stay reference-only unless a later design revisits isolation.

## 9. Delivery order

1. Design approval (this doc).
2. Git worktree + implementation plan (TDD tasks).
3. Live-path audit + field filter + four-call cap + summarizer stage on existing agent.
4. Guided three-chip copy + workspace SEO/GEO tab parity as needed.
5. RAG tool when #103 unblocks; GSC scaffold only if setup UI requires it.
6. Optional later: bounded deep research job (#121) on Workflows.

## 10. Non-goals reminder

Do not claim causal Google ranking effects without sources. Do not auto-publish. Do not bypass approval for GEO/expensive calls. Do not wait on task queues for “standard” DFS endpoints.
