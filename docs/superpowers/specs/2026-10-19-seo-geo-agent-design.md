# SEO/GEO Agent — Design

Date: 19 Oct 2026 · Owner: Liam Wilson · Status: approved in conversation, awaiting written-spec review

## 1. Purpose

Workspace owners build AI and developer tools and are not SEO specialists. They should be able to ask a basic or advanced SEO/GEO question in plain English ("which keywords does Pinecone rank for that we don't?", "does ChatGPT mention us for 'vector database'?") and get an answer grounded in live DataForSEO data, with the endpoints chosen for them. The agent also teaches: suggested questions show what is possible before the user types.

Success looks like:
- A new user clicks a suggested question and gets a useful, data-backed answer without knowing any endpoint names.
- Every answer ends with three relevant follow-up questions (SEO, GEO, Content).
- Spend stays inside the $70 DataForSEO balance and the existing daily caps; no question can loop on paid calls.

## 2. Scope

This is sub-project 1+2 of four:

1. **Cache retention** (this spec): keep every DataForSEO response as a dated snapshot, shared by all workspaces.
2. **SEO/GEO agent** (this spec): chat at `/seo`, classifier, executor, tools over four endpoint families, suggestions, approval flow, metering.
3. RAG knowledge base of SEO case studies and insights (later spec; adds a `search_insights` tool).
4. Blog drafting with the humanizer pass (later spec; [blader/humanizer](https://github.com/blader/humanizer), MIT).

Out of scope here: RAG, full blog drafts, GSC, scheduled GEO tracking, chat on other pages.

## 3. Decisions taken

| Decision | Choice |
|---|---|
| Build order | Agent first (with cache retention), then RAG, then blog + humanizer |
| Endpoint families in v1 | Backlinks, Labs keyword research, SERP (Google organic), AI Optimization (GEO) |
| Runtime | Vercel AI SDK (`ai`, `@ai-sdk/gateway`) in a Next route handler; conversations in Neon. Not the Cloudflare Agents SDK (it uses the AI SDK underneath and adds Durable Objects and a second store) |
| Models | Through Vercel AI Gateway, chosen by env var: main/executor Sonnet 5.5 (`anthropic/claude-sonnet-5.5`), cheap classifier DeepSeek (exact Gateway id set by `SEO_CLASSIFIER_MODEL`) |
| Approach | Classify, then a scoped, capped tool loop |
| Metering | A monthly agent-question limit plus the existing SEO data credits |
| Approval | Ask above 3 data credits per question; AI Optimization calls always ask until the owner lifts it |
| UI | `/seo` becomes the agent chat; the backlink report becomes a tool |
| Cache | Never delete responses; shared across workspaces; freshness windows per family |
| Suggestions | 3 starter chips above the input (SEO, GEO, Content), and 3 AI-chosen follow-ups after every answer |

## 4. Architecture

```
/seo page (client chat, @ai-sdk/react useChat)
   │  POST /seo/chat  { conversationId?, message } | { approvePlan: messageId }
   ▼
app/seo/chat/route.ts
   1 authorizeWorkspace → 403 generic
   2 consume seo_questions_per_month (atomic) → upgrade message if none left
   3 load conversation (workspace-scoped) + monitoring profile
   4 classify (DeepSeek)  ──► concept / out_of_scope: answer with no data tools
   5 execute (Sonnet 5.5, intent's tools only, ≤6 steps, ≤3 credits)
   6 stream text + result cards + follow-ups + credits line
   7 persist assistant message (complete | incomplete | needs_approval)
         │
         ▼ every data tool
   lib/dataforseo/* wrapper → gate (cache → workspace credits → balance floor → daily cap → runPaidCall)
```

### 4.1 Units

| Unit | Responsibility |
|---|---|
| `app/seo/chat/route.ts` | Auth, question metering, load context, orchestrate, stream (AI SDK UI message stream), persist |
| `app/seo/page.tsx` + client chat component | Conversation sidebar, message list, result cards, chips, approval buttons |
| `lib/seo-agent/models.ts` | Gateway provider, model ids from env, per-model token prices (config), `costOf(usage)` |
| `lib/seo-agent/classify.ts` | One classifier call → validated `Intent` (Zod); fallback to `"all"` on failure |
| `lib/seo-agent/tools/*.ts` | One AI SDK `tool()` per data call, `strict: true` Zod input, budget check, trimmed output |
| `lib/seo-agent/budget.ts` | Per-question credit ledger shared by the tools of one request |
| `lib/seo-agent/execute.ts` | `streamText` loop: system prompt, tool subset, step cap, refusal retry |
| `lib/seo-agent/suggestions.ts` | Starter templates, fallback follow-ups, cost labels |
| `lib/seo-agent/conversations.ts` | Workspace-scoped CRUD for conversations and messages |
| `lib/dataforseo/labs.ts`, `serp.ts`, `ai-optimization.ts` | New typed wrappers + trims, same pattern as `backlinks.ts` |

### 4.2 Intents and tool subsets

The classifier returns `{ intent, domains: string[], keywords: string[], engines?: string[] }`.

| Intent | Tools |
|---|---|
| `concept` | none: the classifier model streams the answer from its own knowledge (RAG later); see 4.5 for follow-ups |
| `out_of_scope` | none: the classifier model streams a short redirect to SEO/GEO topics |
| `backlinks` | `backlink_summary`, `referring_domains`, `backlink_gap`, `anchors` |
| `keywords` | `keyword_ideas`, `keyword_overview`, `ranked_keywords`, `competitor_domains`, `keyword_gap` |
| `serp` | `google_serp`, `keyword_overview` |
| `geo_visibility` | `llm_response`, `ai_keyword_volume`, `google_serp` |
| `content` | `keyword_ideas`, `keyword_overview`, `google_serp`, `ranked_keywords` |
| `all` (classifier failed) | every tool above, same caps |

Every intent also gets `suggest_follow_ups` (local, free).

### 4.3 Tools and DataForSEO endpoints

All default to `location_code: 2840` (US) and `language_code: "en"`.

| Tool | Endpoint | Credits | Freshness |
|---|---|---|---|
| `backlink_summary` | `/v3/backlinks/summary/live` | 1 | 30 d |
| `referring_domains` | `/v3/backlinks/referring_domains/live` | 1 | 30 d |
| `backlink_gap` | two `referring_domains` calls, gap computed locally | 1 per uncached side | 30 d |
| `anchors` | `/v3/backlinks/anchors/live` | 1 | 30 d |
| `keyword_ideas` | `/v3/dataforseo_labs/google/keyword_ideas/live` | 1 | 30 d |
| `keyword_overview` | `/v3/dataforseo_labs/google/keyword_overview/live` (volume, difficulty, intent) | 1 | 30 d |
| `ranked_keywords` | `/v3/dataforseo_labs/google/ranked_keywords/live` | 1 | 30 d |
| `competitor_domains` | `/v3/dataforseo_labs/google/competitors_domain/live` | 1 | 30 d |
| `keyword_gap` | `/v3/dataforseo_labs/google/domain_intersection/live` | 1 | 30 d |
| `google_serp` | `/v3/serp/google/organic/live/advanced` (depth 10) | 1 | 7 d |
| `llm_response` | `/v3/ai_optimization/{chat_gpt,claude,gemini,perplexity}/llm_responses/live` | 2 per engine | 7 d per prompt + engine + location |
| `ai_keyword_volume` | `/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live` | 1 | 30 d |
| `suggest_follow_ups` | local | 0 | — |

Endpoint paths come from the official `dataforseo-client` 2.1.9 package. Per-call USD estimates (used for the gate's reservation; the ledger records the `cost` DataForSEO returns) live in one config map, set to conservative upper bounds, and must be confirmed against DataForSEO's pricing pages before launch. Credit weights are config too.

### 4.4 Per-question budget and approval

- A request-scoped `QuestionBudget` starts at 3 credits (`SEO_AGENT_AUTO_CREDITS`, default 3).
- Before a tool spends, it computes its uncached cost (it peeks the cache first). If the cost fits, it reserves the credits and calls the gate. If not, or if the tool is in the always-ask set (`llm_response` while `SEO_AGENT_GEO_ALWAYS_ASK` is not `"false"`), it returns `{ status: "needs_approval", call }` without fetching.
- At the end of the loop, any `needs_approval` results become the message's **plan**: a list of `{ tool, input, credits }`, saved on the assistant message (status `needs_approval`), with Run it / Cancel buttons and the credit total.
- **Run it** posts `{ approvePlan: messageId }`. The route checks that the message belongs to the workspace, is `needs_approval` and hasn't run yet, then marks it `approved` in the same statement, so a double click can't run it twice. It runs exactly those calls (no re-planning, so the user pays what they saw), then asks the executor to write a new assistant message from the results. This charges no new question.
- Approval never bypasses the monthly credits, the balance floor or the daily cap.

### 4.5 Suggestions

**Starter chips (before typing).** Three chips above the input, in a fixed order: SEO, GEO, Content.
- Built from templates filled with the latest monitoring profile (`productUrl` domain, first competitor, first topic). Several templates per category rotate daily.
- An empty profile uses generic dev-tool templates.
- Each chip shows a cost label. "Free (cached)" means the call the template needs is cached; "~N credits" otherwise; "Needs approval" for GEO while the always-ask rule is on.

**Follow-ups (after every answer).** The system prompt tells the executor to finish by calling `suggest_follow_ups` with `{ seo, geo, content }` (strict schema, each ≤ 140 chars), tied to what it just found.
- Forced `tool_choice` is not used (it returns a 400 on Sonnet 5.5); the instruction lives in the prompt.
- For `concept` and `out_of_scope` answers, which use no tools, follow-ups come from one extra structured-output call to the classifier model (`{ seo, geo, content }`). DeepSeek is never asked to call tools.
- If the call is missing or invalid, the template set fills in, so three chips always render.
- Follow-ups carry the same cost labels.
- Content chips in v1 promise a plan (topic, target keywords, outline, gap), never a finished post, until sub-project 4.

### 4.6 Cache retention

- New table `dataforseo_snapshot` (`id`, `cache_key`, `endpoint`, `response_json`, `fetched_at`; index `(cache_key, fetched_at desc)`).
- Writes insert a new row, never overwrite. Reads take the newest row whose `fetched_at` is within the endpoint family's freshness window. Windows are applied at read time, so changing them affects existing rows.
- `dataforseo_cache` (from #78) is read as a fallback during the transition and dropped in a later release (expand/contract). Nothing deletes snapshot rows.
- The cache stays global (public SEO data, keyed only on env, version, endpoint and normalised params). Spend stays attributed per workspace in `cost_event`.

### 4.7 Metering

- New metered plan limit `seo_questions_per_month`: free 10, Pro 150. Stored as data (`plan_limit` seed), counted in a new `workspace_usage.seo_questions` column.
- One question = one user message. Approval runs and refusal retries don't count.
- Data credits (`seo_credits_per_month`, free 6 / Pro 60) are unchanged and charged per uncached call, using the tool's credit weight.
- Model calls go through `runPaidCall` (provider `gateway`, actions `seo_classify` / `seo_execute`), with cost computed from token usage and per-model prices in `models.ts`.
- `/pricing` lists both limits.

### 4.8 Per-provider reservations (fix to `runPaidCall`)

- Today `provider_budget_day` allows one open paid reservation per UTC day, across all providers. Streaming model calls would block DataForSEO calls and scan collectors.
- Add a table `provider_budget_reservation` keyed `(day, provider)`, with the same atomic reserve/settle statements. `runPaidCall` uses it, so each provider serialises only against itself.
- Its cap is `VANTAGE_PAID_DAILY_BUDGET_USD` per provider unless `VANTAGE_PAID_DAILY_BUDGET_<PROVIDER>_USD` is set.
- The old table stays until a later release.

### 4.9 Data model

| Table | Columns |
|---|---|
| `seo_conversation` | `id uuid pk`, `workspace_id fk → workspace (cascade)`, `title text`, `created_at`, `updated_at`; index `(workspace_id, updated_at desc)` |
| `seo_message` | `id uuid pk`, `conversation_id fk (cascade)`, `workspace_id fk (cascade)`, `role ('user'\|'assistant')`, `content text`, `parts jsonb` (cards, follow-ups, plan), `status ('complete'\|'incomplete'\|'needs_approval'\|'approved')`, `credits_used int`, `created_at`; index `(conversation_id, created_at)` |
| `dataforseo_snapshot` | see 4.6 |
| `provider_budget_reservation` | `day date`, `provider text`, `spent_usd`, `cap_usd`, `reservation_ref`; pk `(day, provider)` |
| `workspace_usage` | add `seo_questions integer not null default 0` |

All migrations are additive and generated with `pnpm db:generate`. Workspace deletion cascades to conversations and messages.

## 5. Error handling

- **Refusal or model error:** check `finishReason`; retry once on `SEO_AGENT_FALLBACK_MODEL` via Gateway model fallbacks. If that fails too: "I can't answer that one. Try rephrasing." and the question is released. Anthropic server-side `fallbacks` is enabled only if the staging test proves the AI SDK's beta header works with it.
- **Classifier failure** (down or invalid JSON): use intent `all` with the same caps.
- **Gate denials** become a short line in the answer ("SEO data lookups are paused today", "Out of data credits — using cached data only"). The agent still answers from what it has and says what's missing. Failed calls refund their credit, as today.
- **Stream failures:** before any text, release the question. After text has started, save the partial answer as `incomplete`.
- **Untrusted data:** tool results (and RAG later) are wrapped as data, and the system prompt forbids following instructions inside them. Tools are read-only. Provider strings render as React text only.
- **Validation:** domains go through `normalizeTarget`. Keywords are trimmed, at most 100 characters, at most 20 per call. Engines are restricted to the four names.

## 6. Security invariants

- `authorizeWorkspace` runs before charging a question, reading a conversation, or any upstream call. Refusals are generic.
- Every conversation/message query filters on `workspaceId`; an authorization test proves cross-workspace reads fail.
- Only `lib/dataforseo/gate.ts` imports the DataForSEO client, and only the chat route reaches paid tools (source-level contract test). The #78 backlink report page and its server action are removed; their tables and gap view live on as the backlink tools' result cards.
- No env reads at module scope (the build must not need `AI_GATEWAY_API_KEY`, `DATAFORSEO_*` or `NEON_AUTH_*`).
- The SEO tab is shown only when DataForSEO is available (existing `dataForSeoAvailable`) and an AI Gateway key is configured.

## 7. Configuration

| Env | Default | Purpose |
|---|---|---|
| `AI_GATEWAY_API_KEY` | — | Vercel AI Gateway (already used by drafting) |
| `SEO_AGENT_MODEL` | `anthropic/claude-sonnet-5.5` | Executor |
| `SEO_CLASSIFIER_MODEL` | — (required) | DeepSeek model id on the Gateway |
| `SEO_AGENT_FALLBACK_MODEL` | — | Refusal and outage fallback |
| `SEO_AGENT_AUTO_CREDITS` | `3` | Credits per question before asking |
| `SEO_AGENT_GEO_ALWAYS_ASK` | `true` | `llm_response` always needs approval |
| `VANTAGE_PAID_DAILY_BUDGET_<PROVIDER>_USD` | — | Optional per-provider daily cap |

## 8. Testing

- **Unit (Vitest, models and DataForSEO mocked):**
  - Classifier parse and fallback.
  - Tool schemas, gate arguments, TTLs, budget and `needs_approval`, GEO always-ask.
  - Executor step cap, approved-plan exactness, refusal retry and refund.
  - Suggestions: always three, ordered SEO/GEO/Content, template fallback, empty-profile defaults, cost labels.
  - Snapshot reuse versus refetch with the old row kept, and no delete path.
  - Per-provider reservations run concurrently across providers but not within one.
- **Authorization:** the route refuses other workspaces before metering or calling anything; conversation queries are scoped (extends `test/workspace-authorization.test.ts`).
- **Contract:** gate-only DataForSEO import; paid tools reachable only from the allowed entry points.
- **Pre-PR:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, Worker `node --test`, drift check, CI Worker bundle job (bundle size with the new `ai` dependencies).
- **Staging (cannot run from this container; DataForSEO and AI Gateway are blocked):**
  - Agent-browser journey: sign in → /seo → starter chip → answer with cards and follow-ups → approval → credits decrease.
  - Gateway check that `cacheControl` and `strict` take effect, and whether server-side `fallbacks` works.
  - The owner's 20-call AI Optimization cost test, which decides when to lift GEO always-ask.

## 9. Risks

- DeepSeek's Gateway model id and tool-calling reliability are unverified; classification uses structured output, not tools, to limit that risk.
- DataForSEO prices are unconfirmed; estimates are conservative and recorded costs are real.
- The AI SDK's server-side fallback beta header may not match the `"default"` form that Sonnet 5.5 requires; client-side retry covers refusals regardless.
- Bundle size: `ai` and `@ai-sdk/gateway` are added to a Worker with a 10 MB limit; the CI job measures it.
