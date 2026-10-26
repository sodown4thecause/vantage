# Repository inspiration for Vantage

**Snapshot: 2026-10-26.** This is a research plan only: no product code changed, no dependency was added, no repository code was copied, and no GitHub issue was created. Every named repository was reachable; none is marked “not reviewed.”

## Summary

| # | Repository | Label | Vantage area | Effort | License | Worker-compatible? | AI spend impact |
|---:|---|---|---|:---:|---|:---:|---|
| 1 | [blader/humanizer](https://github.com/blader/humanizer) | Borrow (idea only) | Content voice / humaniser | S | MIT | Yes* | Neutral |
| 2 | [miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop) | Borrow (idea only) | Content quality and accessible UI | S | MIT | Yes* | Neutral |
| 3 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | Borrow (idea only) | Content writing | S | MIT | Yes* | Neutral |
| 4 | [kostja94/marketing-skills](https://github.com/kostja94/marketing-skills) | Borrow (idea only) | Blog/article briefs | S | MIT | Yes* | Neutral |
| 5 | [OpenClaudia/openclaudia-skills](https://github.com/OpenClaudia/openclaudia-skills) | Borrow (idea only) | Content strategy | S | MIT | Yes* | Neutral |
| 6 | [stanford-oval/storm](https://github.com/stanford-oval/storm) | Borrow (idea only) | Source-backed research | L | MIT | No | Raise |
| 7 | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Borrow (idea only) | Research executor #120/#121 | L | Apache-2.0 | No | Raise |
| 8 | [vercel/ai](https://github.com/vercel/ai) | Adopt (dependency, already present) | Chat / tool loop / streaming | S | Apache-2.0 | Yes | Unclear |
| 9 | [vercel/chatbot](https://github.com/vercel/chatbot) | Borrow (idea only) | Generative UI and artifacts | M | Apache-2.0 | No | Raise |
| 10 | [tambo-ai/tambo](https://github.com/tambo-ai/tambo) | Skip | Generative UI | S | MIT | No | Unclear |
| 11 | [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui) | Borrow (idea only) | Chat UX | M | MIT | Yes* | Neutral |
| 12 | [shadcn-ui/chatbot-template](https://github.com/shadcn-ui/chatbot-template) | Borrow (idea only) | Chat safeguards | S | MIT | No | Raise |
| 13 | [nokia-applied-research/AnyJev](https://github.com/nokia-applied-research/AnyJev) | Borrow (idea only) | Scoring calibration | L | Apache-2.0 | No | Unclear |
| 14 | [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya) | Borrow (idea only) | Relevance confidence | L | Apache-2.0 | No | Unclear |
| 15 | [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | Borrow (idea only) | Scoring/content evals | M | MIT | No | Neutral |
| 16 | [mattpocock/evalite](https://github.com/mattpocock/evalite) | Borrow (idea only) | Offline eval harness | M | MIT | No | Neutral |
| 17 | [langfuse/langfuse](https://github.com/langfuse/langfuse) | Borrow (idea only) | AI spend / observability #108 | M | MIT outside separately licensed Enterprise areas | No | Neutral |
| 18 | [MaartenGr/BERTopic](https://github.com/MaartenGr/BERTopic) | Borrow (idea only) | Topic trends #99/#136 | L | MIT | No | Neutral |
| 19 | [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT) | Borrow (idea only) | Topic digest #99/#136 | M | MIT | No | Raise |
| 20 | [miantiao-me/hacker-podcast](https://github.com/miantiao-me/hacker-podcast) | Borrow (idea only) | HN summaries / content | M | AGPL-3.0 | Yes | Raise |
| 21 | [twalichiewicz/Backchannel](https://github.com/twalichiewicz/Backchannel) | Borrow (idea only) | Linked-content enrichment #99/#136 | M | MIT | Yes* | Neutral |
| 22 | [Straitly-ai/consensus](https://github.com/Straitly-ai/consensus) | Borrow (idea only) | Bounded research #120/#121 | L | MIT | No | Raise |
| 23 | [Ryze-AI-Adgent/open-seo-mcp-skills](https://github.com/Ryze-AI-Adgent/open-seo-mcp-skills) | Borrow (idea only) | SEO content briefs | S | MIT | Yes* | Unclear |
| 24 | [unifapi-agent/agents](https://github.com/unifapi-agent/agents) | Borrow (idea only) | Cross-source content demand | S | MIT | Yes* | Unclear |
| 25 | [toofast1/awesome-ai-lead-generation](https://github.com/toofast1/awesome-ai-lead-generation) | Borrow (idea only) | Agent/competitor discovery #139 | S | MIT | Yes* | Neutral |
| 26 | [cloudflare/agents](https://github.com/cloudflare/agents) | Borrow (idea only) | Future read-only MCP / Worker architecture | M | MIT | No | Unclear |
| 27 | [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl) | Borrow (idea only) | Existing Firecrawl provider route | M | AGPL-3.0 | No | Unclear |
| 28 | [getanyapi-com/lurk](https://github.com/getanyapi-com/lurk) | Study (competitor) | Intent funnel / cost visibility | M | MIT | No | Raise |
| 29 | [yangyixxxx/lead-signal-listener](https://github.com/yangyixxxx/lead-signal-listener) | Study (competitor) | Transparent scoring | M | MIT | No | Lower |
| 30 | [eracle/OpenOutreach](https://github.com/eracle/OpenOutreach) | Borrow (idea only) | Adjacent B2B lead workflow | S | GPL-3.0 | No | Raise |

* **Worker compatibility** means the reviewed reuse surface can avoid Python, Node-only APIs, and a long-running process in Cloudflare Workers. For a prompt/Markdown-only recommendation, “Yes” means the text can be embedded or stored as static content; it does not endorse running that repository’s installer or helper scripts in a Worker. “No” means its relevant implementation is incompatible as-is or depends on a hosted service. A **Worker** is Cloudflare’s request-oriented JavaScript runtime; Durable Objects and Workflows are Cloudflare-managed primitives, not permission to run an unbounded process.

## Review method and guardrails

Each entry below records the current default-branch HEAD commit date, GitHub’s repository license metadata checked against the root license file, the README, and a representative source file (or the README itself for the list-only repository). The clones were depth-one, sparse clones under `/tmp`, outside the Vantage checkout. Dates are the latest commit dates visible in those clones; pushed-at timestamps can be later than a commit’s authored/committer date. “Cost per call” is a portable estimate only where the repository publishes one: otherwise it states the software cost separately from model, data-provider, and hosting usage, which vary by model and account. No source is copied, including from permissively licensed repositories; AGPL/GPL repositories are idea-only or skipped.

**Hard boundaries:** Vantage remains read-only. Do not recommend Vantage auto-posting, scheduling, commenting, voting, or emailing. If a future user-controlled calendar handoff is useful, point to [pendpost](https://pendpost.com) rather than adding a publisher. Do not scrape pages directly from Workers; fetch page content through Firecrawl or an already approved provider. No recommendation below adds a dependency or authorizes a code change. The issue text at the end is draft text only.

**Terms:** S/M/L means small/medium/large implementation effort; AI-spend labels are directional for the proposed reuse (neutral means no additional paid model call by default); SERP means search-engine results page; MCP means Model Context Protocol, a tool-connection protocol; GSC means Google Search Console; ICP means ideal customer profile; HN means Hacker News; CLI means command-line interface; precision@5 is the share of relevant items in the first five; NDCG@5 is a ranking-quality metric that rewards relevant items nearer the top; a holdout set is examples kept separate from tuning; TTS means text-to-speech. Provider-data and hosting charges are separate from model inference.

## Repository notes

### 1. [blader/humanizer](https://github.com/blader/humanizer)

**Evidence:** [README](https://github.com/blader/humanizer/blob/main/README.md) · [SKILL.md](https://github.com/blader/humanizer/blob/main/SKILL.md). **License / last commit / Worker:** MIT / 2026-10-16 / Yes for the static skill text (the repo’s validator is Python and is not a Vantage runtime dependency). **Vantage map:** [Content workspace](../../app/content/page.tsx), [grounded drafting](../../lib/drafting/generate.ts). **Decision:** **Borrow (idea only)** — preserve meaning and facts while removing generic patterns; explicitly do not optimize for AI-detector evasion. This is a strong fit for the planned humaniser and factual-claim guard. **Effort:** S. **Approx. call cost / AI spend:** $0 software fee; neutral if the rubric is folded into the existing draft call, but a separate rewrite call raises token use. The repo publishes no model price.

### 2. [miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop)

**Evidence:** [README](https://github.com/miqdadbadjuber/anti-slop/blob/main/README.md) · [copywriting skill](https://github.com/miqdadbadjuber/anti-slop/blob/main/skills/antislop-copywriting/SKILL.md) · [human/accessibility skill](https://github.com/miqdadbadjuber/anti-slop/blob/main/skills/antislop-human/SKILL.md). **License / last commit / Worker:** MIT / 2026-10-26 / Yes for prompt-only ideas; do not run its Python contrast checker in Workers. **Vantage map:** content voice in [app/content/page.tsx](../../app/content/page.tsx), including accessible states and readable editorial controls. **Decision:** **Borrow (idea only)** — its pattern → why it hurts → fix format turns vague “avoid slop” advice into reviewable checks and includes accessibility. **Effort:** S. **Approx. call cost / AI spend:** $0 for the checklist itself; neutral if deterministic, or marginal tokens if included in a model prompt; no service price is published.

### 3. [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)

**Evidence:** [README](https://github.com/coreyhaines31/marketingskills/blob/main/README.md) · [copywriting skill](https://github.com/coreyhaines31/marketingskills/blob/main/skills/copywriting/SKILL.md) · [copywriting eval examples](https://github.com/coreyhaines31/marketingskills/blob/main/skills/copywriting/evals/evals.json). **License / last commit / Worker:** MIT / 2026-10-19 / Yes for static skills only. **Vantage map:** [draft workflow](../../app/content/page.tsx) and [grounded draft checks](../../lib/drafting/generate.ts). **Decision:** **Borrow (idea only)** — diagnose whether the brief is missing, the voice is known, or the user requested a point edit; require support for claims and cite what evidence would unlock a declined claim. **Effort:** S. **Approx. call cost / AI spend:** no skill fee; neutral when used in the existing generation request, higher if every task triggers a second copywriting call.

### 4. [kostja94/marketing-skills](https://github.com/kostja94/marketing-skills)

**Evidence:** [README](https://github.com/kostja94/marketing-skills/blob/main/README.md) · [article-content skill](https://github.com/kostja94/marketing-skills/blob/main/skills/content/article/SKILL.md). **License / last commit / Worker:** MIT / 2026-10-21 / Yes for static prompt material. **Vantage map:** [content workflow](../../app/content/page.tsx) and [research cards](../../lib/research/blocks.ts). **Decision:** **Borrow (idea only)** — structure article briefs around search intent, answer-first writing, scannability, and information density; use only as optional brief guidance, not a copied template. **Effort:** S. **Approx. call cost / AI spend:** $0 per skill use apart from the existing model’s tokens; neutral if integrated into the current prompt, raised if it becomes another generation step.

### 5. [OpenClaudia/openclaudia-skills](https://github.com/OpenClaudia/openclaudia-skills)

**Evidence:** [README](https://github.com/OpenClaudia/openclaudia-skills/blob/main/README.md) · [content-strategy skill](https://github.com/OpenClaudia/openclaudia-skills/blob/main/skills/content-strategy/SKILL.md). **License / last commit / Worker:** MIT / 2026-10-21 / Yes for the static skill only; its Node installer is not a Worker target. **Vantage map:** content planning in [app/content/page.tsx](../../app/content/page.tsx). **Decision:** **Borrow (idea only)** — collect business goal, audience, current content, and competitors before proposing an editorial direction; exclude its broader publishing and automation capabilities. **Effort:** S. **Approx. call cost / AI spend:** no direct software fee; the plan’s model tokens are unpriced in the repo and can be kept neutral by adding the questions to the existing brief call.

### 6. [stanford-oval/storm](https://github.com/stanford-oval/storm)

**Evidence:** [README](https://github.com/stanford-oval/storm/blob/main/README.md) · [STORM wiki engine](https://github.com/stanford-oval/storm/blob/main/knowledge_storm/storm_wiki/engine.py). **License / last commit / Worker:** MIT / 2025-09-30 / No — Python/DSPy research engine. **Vantage map:** source-grounded research cards in [lib/research/blocks.ts](../../lib/research/blocks.ts) and [SEO research tools](../../lib/seo-agent/tools/research.ts). **Decision:** **Borrow (idea only)** — use its staged question/outline/source synthesis and citation discipline when designing content briefs; do not port its Python pipeline or run a multi-perspective report for every lead. **Effort:** L. **Approx. call cost / AI spend:** no universal report price; multiple research and generation calls plus search can raise spend materially, all provider-dependent.

### 7. [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher)

**Evidence:** [README](https://github.com/assafelovic/gpt-researcher/blob/main/README.md) · [research agent](https://github.com/assafelovic/gpt-researcher/blob/main/gpt_researcher/agent.py). **License / last commit / Worker:** Apache-2.0 / 2026-10-10 / No — Python/async orchestration and external research execution. **Vantage map:** bounded research executor [#120/#121](https://github.com/sodown4thecause/vantage/issues/120), [research loop](../../lib/seo-agent/execute.ts). **Decision:** **Borrow (idea only)** — retain the planner→search→evidence-filter→cited-answer separation, but bound it to the existing provider allowlist, explicit per-call spend, and request/workflow budgets. **Effort:** L. **Approx. call cost / AI spend:** no fixed per-report price; repeated LLM steps and searches raise spend versus one-shot generation.

### 8. [vercel/ai](https://github.com/vercel/ai)

**Evidence:** [AI SDK README](https://github.com/vercel/ai/blob/main/packages/ai/README.md) · [ToolLoopAgent](https://github.com/vercel/ai/blob/main/packages/ai/src/agent/tool-loop-agent.ts). **License / last commit / Worker:** Apache-2.0 / 2026-10-25 / Yes for the AI SDK runtime used through web APIs. **Vantage map:** already installed in [package.json](../../package.json), used by [the chat client](../../app/seo/chat-client.tsx) and [agent executor](../../lib/seo-agent/execute.ts). **Decision:** **Adopt (dependency, already present)** — keep using the existing `ai` and `@ai-sdk/react` primitives for typed streaming and tool loops; do not add a competing chat framework. **Effort:** S. **Approx. call cost / AI spend:** the SDK adds no per-call charge; model and tool-loop usage are billed through the existing gateway. Extra agent steps can raise spend, so keep step and budget caps.

### 9. [vercel/chatbot](https://github.com/vercel/chatbot)

**Evidence:** [README](https://github.com/vercel/chatbot/blob/main/README.md) · [chat route](https://github.com/vercel/chatbot/blob/main/app/(chat)/api/chat/route.ts). **License / last commit / Worker:** Apache-2.0 / 2026-07-08 / No as a complete template; it relies on Vercel-specific functions and a Next/Vercel persistence stack. **Vantage map:** generative UI and saveable results in [app/seo/chat-client.tsx](../../app/seo/chat-client.tsx), [lib/workspace/blocks.ts](../../lib/workspace/blocks.ts), and [workspace artifacts](../../lib/workspace/saved-artifacts.ts). **Decision:** **Borrow (idea only)** — examine its typed artifacts, resumable chat, and tool-result rendering, but preserve Vantage’s workspace authorization and existing streaming contract. **Effort:** M. **Approx. call cost / AI spend:** no per-call software price; model/tool calls are variable. The template itself warns that public chat traffic spends gateway credits and needs authentication, rate limits, and spend limits.

### 10. [tambo-ai/tambo](https://github.com/tambo-ai/tambo)

**Evidence:** [README](https://github.com/tambo-ai/tambo/blob/main/README.md) · [React client provider](https://github.com/tambo-ai/tambo/blob/main/react-sdk/src/providers/tambo-client-provider.tsx). **License / last commit / Worker:** MIT / 2026-10-09 / No as a complete product; the full solution includes a Node backend and the hosted Tambo API is shutting down on 2026-10-31. **Vantage map:** existing [AI SDK UI messages](../../app/seo/chat-wire.ts) and [research blocks](../../lib/research/blocks.ts). **Decision:** **Skip** — although registered-schema components are relevant to generative UI, shutdown and backend/service coupling make this a poor foundation when Vantage already has typed UI blocks. **Effort:** S (screening only). **Approx. call cost / AI spend:** no stable service price to adopt; self-hosting/model costs are unknown and would add operational burden. No source is copied.

### 11. [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui)

**Evidence:** [README](https://github.com/assistant-ui/assistant-ui/blob/main/README.md) · [AI SDK hooks](https://github.com/assistant-ui/assistant-ui/blob/main/packages/ai-sdk/src/hooks.ts). **License / last commit / Worker:** MIT / 2026-10-26 / Yes for the React client package; do not infer compatibility for every example or server package in the monorepo. **Vantage map:** [custom chat experience](../../app/seo/chat-client.tsx) and [typed chat wire](../../app/seo/chat-wire.ts). **Decision:** **Borrow (idea only)** — inspect its separation of thread/runtime state and its access to `useChat` helpers when polishing conversation UX; no package change is justified before a focused UI gap is demonstrated. **Effort:** M. **Approx. call cost / AI spend:** UI code has no inference cost and is neutral; the existing model calls remain the cost driver.

### 12. [shadcn-ui/chatbot-template](https://github.com/shadcn-ui/chatbot-template)

**Evidence:** [README](https://github.com/shadcn-ui/chatbot-template/blob/main/README.md) · [AI SDK route](https://github.com/shadcn-ui/chatbot-template/blob/main/app/api/chat/route.ts). **License / last commit / Worker:** MIT / 2026-10-15 / No as a full app template; it is a Next/Vercel Gateway setup and has not been shown to run on Vantage’s Worker adapter. **Vantage map:** [agent API](../../app/seo/chat/route.ts), [paid-call meter](../../lib/providers/paid-call.ts). **Decision:** **Borrow (idea only)** — its explicit output-token ceiling, model allowlist, and warning that unauthenticated chat spends credits reinforce safeguards Vantage already needs to preserve. **Effort:** S. **Approx. call cost / AI spend:** each generation costs model tokens; tool calls can add more. There is no universal price; the template explicitly tells operators to set spend and request controls.

### 13. [nokia-applied-research/AnyJev](https://github.com/nokia-applied-research/AnyJev)

**Evidence:** [README](https://github.com/nokia-applied-research/AnyJev/blob/main/README.md) · [decision pipeline](https://github.com/nokia-applied-research/AnyJev/blob/main/anyjev/decider.py). **License / last commit / Worker:** Apache-2.0 / 2026-10-21 / No — Python and NumPy model processing. **Vantage map:** [opportunity features](../../lib/opportunities/features.ts), [intent ladder](../../lib/pipeline/intent-ladder.ts), and [offline learning evaluation](../../lib/learning/evaluate.ts). **Decision:** **Borrow (idea only)** — test whether candidate order, label wording, or calibration changes a model’s decisions before trusting its scores; keep the current deterministic baseline and holdout gate. **Effort:** L. **Approx. call cost / AI spend:** the library is not a model price; inference/probes can raise calls, while the proposed offline fixtures need no model spend.

### 14. [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya)

**Evidence:** [README](https://github.com/NandhaKishorM/laya/blob/main/README.md) · [TypeScript decision agent](https://github.com/NandhaKishorM/laya/blob/main/laya-ts/src/agent.ts). **License / last commit / Worker:** Apache-2.0 / 2026-10-26 / No — the repository includes Python packages and local model/runtime paths; no compatible Worker deployment was established. **Vantage map:** low-confidence review thresholds in [lib/opportunities/features.ts](../../lib/opportunities/features.ts) and relevance gate #139. **Decision:** **Borrow (idea only)** — its typed choices, explicit confidence, and abstention are useful evaluation concepts; do not adopt its learned models or infer that confidence scores are calibrated for Vantage data. **Effort:** L. **Approx. call cost / AI spend:** local inference moves cost to compute/hosting; remote inference is model-priced. The repo gives no Vantage-comparable unit price, so spend impact is unclear.

### 15. [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo)

**Evidence:** [README](https://github.com/promptfoo/promptfoo/blob/main/README.md) · [evaluator](https://github.com/promptfoo/promptfoo/blob/main/src/evaluator.ts). **License / last commit / Worker:** MIT / 2026-10-25 / No — the CLI uses Node modules such as `readline`, `util`, filesystem/glob and a local evaluation runtime. **Vantage map:** [offline ranking replay](../../lib/learning/evaluate.ts), [intent tests](../../lib/pipeline/intent-ladder.ts), and #139. **Decision:** **Borrow (idea only)** — use fixed prompt/fixture cases and explicit expected assertions as a review pattern, not a runtime dependency; Vantage already has Vitest and a deterministic replay harness. **Effort:** M. **Approx. call cost / AI spend:** fixture-only checks are $0; model-graded evals scale with cases × model calls and raise spend. No per-case price is published.

### 16. [mattpocock/evalite](https://github.com/mattpocock/evalite)

**Evidence:** [README](https://github.com/mattpocock/evalite/blob/main/readme.md) · [eval runtime](https://github.com/mattpocock/evalite/blob/main/packages/evalite/src/evalite.ts). **License / last commit / Worker:** MIT / 2025-11-10 / No — the reviewed runner imports `fs/promises`, `path`, and Vitest. **Vantage map:** [learning evaluation](../../lib/learning/evaluate.ts) and current test fixtures. **Decision:** **Borrow (idea only)** — its local-first, TypeScript-native evaluation loop is a useful developer-experience reference, but its latest visible commit is old and the existing replay/CI path avoids a second evaluation framework. **Effort:** M. **Approx. call cost / AI spend:** no UI/framework fee; actual model-backed test calls are variable and can raise spend. Offline fixtures cost $0.

### 17. [langfuse/langfuse](https://github.com/langfuse/langfuse)

**Evidence:** [README](https://github.com/langfuse/langfuse/blob/main/README.md) · [license terms](https://github.com/langfuse/langfuse/blob/main/LICENSE) · [evaluation service](https://github.com/langfuse/langfuse/blob/main/worker/src/features/evaluation/evalService.ts). **License / last commit / Worker:** MIT outside `ee/` (which has its own license) / 2026-10-25 / No — the reviewed service uses `node:crypto`, Prisma and queue workers. **Vantage map:** [paid-call reservations and ledger](../../lib/providers/paid-call.ts), [cost ledger docs](../costs.md), and observability #108. **Decision:** **Borrow (idea only)** — keep prompt/model/provider/version and usage attribution visible in Vantage’s own metering; the current cost ledger is already a narrower fit than self-hosting a tracing platform. Never copy EE code. **Effort:** M. **Approx. call cost / AI spend:** observability has no standard per-call price; storage, event volume, hosting and any evaluation calls vary. Basic traces need not add model inference.

### 18. [MaartenGr/BERTopic](https://github.com/MaartenGr/BERTopic)

**Evidence:** [README](https://github.com/MaartenGr/BERTopic/blob/master/README.md) · [topic model](https://github.com/MaartenGr/BERTopic/blob/master/bertopic/_bertopic.py). **License / last commit / Worker:** MIT / 2026-08-27 / No — Python with NumPy, pandas, SciPy, joblib and model backends. **Vantage map:** [near-duplicate groups](../../lib/pipeline/dedupe.ts), semantic scoring, and linked-content trends #99/#136. **Decision:** **Borrow (idea only)** — distinguish stable topic labels from topic-over-time changes and compare clusters against human labels; implement any future rollup with existing vectors/provider data, not BERTopic’s Python/transformer stack. **Effort:** L. **Approx. call cost / AI spend:** no price per topic; local clustering shifts cost to CPU/GPU and optional embeddings, potentially reducing separate LLM summaries. AI spend is neutral only if the existing vectors suffice.

### 19. [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)

**Evidence:** [README](https://github.com/KKKKhazix/AIHOT/blob/main/README.md) · [editorial prompt loader](https://github.com/KKKKhazix/AIHOT/blob/main/packages/backend/src/editorial/prompts.ts) · [selection-score prompt](https://github.com/KKKKhazix/AIHOT/blob/main/industry/prompts/selection-score.md). **License / last commit / Worker:** MIT / 2026-10-24 / No — its prompt loader uses `node:crypto`, filesystem reads and a Node/Postgres job stack. **Vantage map:** [scoring pipeline](../../lib/pipeline/run.ts), [topic grouping](../../lib/pipeline/dedupe.ts), and #99/#136. **Decision:** **Borrow (idea only)** — version editorial prompts and selection criteria, and keep a daily brief’s evidence and grouping rules explicit; adapt text/config patterns only. **Effort:** M. **Approx. call cost / AI spend:** daily selection, summarization and digest generation can raise model spend; no comparable per-call price is disclosed.

### 20. [miantiao-me/hacker-podcast](https://github.com/miantiao-me/hacker-podcast)

**Evidence:** [README](https://github.com/miantiao-me/hacker-podcast/blob/main/README.md) · [writing prompts](https://github.com/miantiao-me/hacker-podcast/blob/main/workflow/prompt.ts). **License / last commit / Worker:** AGPL-3.0 / 2026-10-21 / Yes for its explicitly Cloudflare Worker/Workflow architecture; do not copy its source under this task. **Vantage map:** HN collector and [research cards](../../lib/research/blocks.ts). **Decision:** **Borrow (idea only)** — plain-language rules ask for concrete facts, source attribution, and restrained phrasing; the scheduled HN summary pipeline is a useful pattern but does not justify adding a podcast or audio lane. **Effort:** M. **Approx. call cost / AI spend:** each summary plus text-to-speech and object storage has variable model, speech and storage costs; the README gives no portable per-story price, so spend would rise if replicated.

### 21. [twalichiewicz/Backchannel](https://github.com/twalichiewicz/Backchannel)

**Evidence:** [README](https://github.com/twalichiewicz/Backchannel/blob/main/README.md) · [Cloudflare asset/redirect worker](https://github.com/twalichiewicz/Backchannel/blob/main/worker.js). **License / last commit / Worker:** MIT / 2026-10-23 / Yes for the reviewed static-asset Worker entry; the core product is a browser extension, not a Vantage Worker runtime. **Vantage map:** linked evidence in [web-discussion collection](../../lib/collectors/web-discussions.ts), [research cards](../../lib/research/blocks.ts), and #99/#136. **Decision:** **Borrow (idea only)** — connect a discussion to the exact page passage it responds to and keep source identity visible; do not build an extension or import cross-site interaction features. **Effort:** M. **Approx. call cost / AI spend:** no inherent model charge; page/comment lookup and hosting depend on providers. AI spend is neutral unless passage matching adds a model call.

### 22. [Straitly-ai/consensus](https://github.com/Straitly-ai/consensus)

**Evidence:** [README](https://github.com/Straitly-ai/consensus/blob/main/README.md) · [staged search pipeline](https://github.com/Straitly-ai/consensus/blob/main/src/v3/run.ts). **License / last commit / Worker:** MIT / 2026-10-19 / No — uses `node:crypto` and Netlify functions with a 60-second request ceiling. **Vantage map:** [research executor](../../lib/seo-agent/execute.ts), [question budget](../../lib/seo-agent/budget.ts), [paid-call meter](../../lib/providers/paid-call.ts), #120/#121. **Decision:** **Borrow (idea only)** — its generated query plan, parallel pools, per-stage limits, off-topic rejection and count reconciliation are useful; keep Vantage’s own capped provider routes and request/workflow limits. **Effort:** L. **Approx. call cost / AI spend:** the multi-search/multi-model workflow raises spend; it applies caps but publishes no universal per-search total.

### 23. [Ryze-AI-Adgent/open-seo-mcp-skills](https://github.com/Ryze-AI-Adgent/open-seo-mcp-skills)

**Evidence:** [README](https://github.com/Ryze-AI-Adgent/open-seo-mcp-skills/blob/main/README.md) · [content brief skill](https://github.com/Ryze-AI-Adgent/open-seo-mcp-skills/blob/main/skills/content-brief/SKILL.md). **License / last commit / Worker:** MIT / 2026-10-23 / Yes* for static skill text; the hosted MCP connector and external SEO service are not Vantage Worker components. **Vantage map:** [DataForSEO SERP tool](../../lib/seo-agent/tools/serp.ts), planned GSC, and [content workspace](../../app/content/page.tsx). **Decision:** **Borrow (idea only)** — compare actual result pages, existing site footholds, and query variants before outlining a post; Vantage already has its own DataForSEO gate, so do not connect an additional hosted MCP. **Effort:** S. **Approx. call cost / AI spend:** skill text is free, but SEO provider lookups may be paid and brief generation uses model tokens; no universal price is stated.

### 24. [unifapi-agent/agents](https://github.com/unifapi-agent/agents)

**Evidence:** [README](https://github.com/unifapi-agent/agents/blob/main/README.md) · [content opportunity brief](https://github.com/unifapi-agent/agents/blob/main/skills/content-strategy-agent/content-opportunity-brief/SKILL.md). **License / last commit / Worker:** MIT / 2026-09-05 / Yes* for static skill text; its OAuth-connected hosted MCP/API service is not a local Worker implementation. **Vantage map:** source-backed demand selection in [content](../../app/content/page.tsx), existing collectors, and #99/#136. **Decision:** **Borrow (idea only)** — a content opportunity should cite a real question and demand evidence across more than one source, not just a generated title; Vantage already owns the providers and workspace scope. **Effort:** S. **Approx. call cost / AI spend:** the text has no fee; public-data API and model calls use provider-specific credits/prices, not a single per-brief cost.

### 25. [toofast1/awesome-ai-lead-generation](https://github.com/toofast1/awesome-ai-lead-generation)

**Evidence:** [README (the repository’s content)](https://github.com/toofast1/awesome-ai-lead-generation/blob/main/README.md). **License / last commit / Worker:** MIT / 2026-09-20 / Yes as static Markdown; it has no application runtime. **Vantage map:** discovery and relevance gate #139; [community catalog](../../lib/communities/catalog.ts). **Decision:** **Borrow (idea only)** — maintain a lightweight landscape taxonomy for monitoring alternatives and source categories, but verify each entry before using it; a curated list is not a vetted source, an endorsement, or discovery data. **Effort:** S. **Approx. call cost / AI spend:** $0 to read; downstream services listed have separate variable prices. No AI spend is required for the list itself.

### 26. [cloudflare/agents](https://github.com/cloudflare/agents)

**Evidence:** [README and Worker-native Durable Object example](https://github.com/cloudflare/agents/blob/main/README.md) · [package entry](https://github.com/cloudflare/agents/blob/main/packages/agents/src/index.ts). **License / last commit / Worker:** MIT / 2026-10-23 / No under the requested strict screen: the package entry imports `node:async_hooks`, even though the project targets Cloudflare Workers. **Vantage map:** possible later read-only MCP/server work in the roadmap; current [Worker entry](../../worker-entry.mjs) and [OpenNext config](../../open-next.config.ts). **Decision:** **Borrow (idea only)** — Durable Object hibernation and explicit per-user state are useful architecture references, but do not adopt this SDK until the Node compatibility dependency is acceptable under Vantage’s own deployment policy. **Effort:** M. **Approx. call cost / AI spend:** no per-call package price; active Durable Object/Worker/storage usage and model calls have separate platform/provider costs. Idle-cost claims in the README are not a Vantage estimate.

### 27. [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl)

**Evidence:** [README](https://github.com/firecrawl/firecrawl/blob/main/README.md) · [scrape controller](https://github.com/firecrawl/firecrawl/blob/main/apps/api/src/controllers/v1/scrape.ts). **License / last commit / Worker:** AGPL-3.0 / 2026-10-25 / No — the self-hosted service uses Express and job/browser workers. **Vantage map:** existing [Firecrawl search](../../lib/firecrawl/search.ts), [provider client](../../lib/firecrawl/client.ts), and [web-discussion collector](../../lib/collectors/web-discussions.ts). **Decision:** **Borrow (idea only)** — continue using only the approved hosted provider interface already in Vantage; no source reuse, self-hosted Firecrawl service, or raw scraping from Workers. **Effort:** M. **Approx. call cost / AI spend:** Vantage already meters Firecrawl search (2 credits per 10 results; USD depends on `FIRECRAWL_CREDIT_USD`) through `runPaidCall`; scrape credits/hosting vary. The service itself adds no model spend unless followed by an LLM.

### 28. [getanyapi-com/lurk](https://github.com/getanyapi-com/lurk)

**Evidence:** [README](https://github.com/getanyapi-com/lurk/blob/main/README.md) · [scan pipeline](https://github.com/getanyapi-com/lurk/blob/main/src/lib/scan/run.ts) · [score function](https://github.com/getanyapi-com/lurk/blob/main/src/lib/scan/score.ts). **License / last commit / Worker:** MIT / 2026-10-15 / No as-is — self-hosting uses a Next/Docker/job stack and paid AnyAPI calls. **Vantage map:** [relevance pipeline](../../lib/pipeline/run.ts), [opportunity scoring](../../lib/opportunities/features.ts), [paid-call ledger](../../lib/providers/paid-call.ts), #120/#121. **Decision:** **Study (competitor)** — Lurk’s Reddit/X buyer-intent funnel does better at showing request-level data cost, subreddit policy, seller-side signals, a scored reason, and paid-work staging. Vantage does better at bringing many communities into one capped daily queue, ranking five signals, grounding draft replies in workspace material, and keeping the user in control. Both say they do not post for the user. **Effort:** M. **Approx. call cost / AI spend:** AnyAPI is pay-per-request and Lurk shows costs per lead, but the README gives no stable price list; staged triage can lower unnecessary hydration, while its model judge can raise per-scan inference spend.

### 29. [yangyixxxx/lead-signal-listener](https://github.com/yangyixxxx/lead-signal-listener)

**Evidence:** [README](https://github.com/yangyixxxx/lead-signal-listener/blob/main/README.md) · [rule-based scoring](https://github.com/yangyixxxx/lead-signal-listener/blob/main/listener/scoring.py). **License / last commit / Worker:** MIT / 2026-10-10 / No — local Python application. **Vantage map:** [feature scoring](../../lib/opportunities/features.ts), [learning replay](../../lib/learning/evaluate.ts), and #139. **Decision:** **Study (competitor)** — it does better at local-first setup, broad connector/endpoint coverage (including hiring/funding triggers), multilingual UI, and transparent no-LLM rule scoring. Vantage does better at managed workspace onboarding, provider-cost controls, evidence-backed ranking across its product surface, and surfacing a small daily shortlist with user-written handoff. **Effort:** M. **Approx. call cost / AI spend:** its README reports one demo run of 284 leads for $0.073 in Treg calls (about $0.00026/lead in that run only; not a general price). Its current rule scoring has no LLM cost; provider/API charges still vary.

### 30. [eracle/OpenOutreach](https://github.com/eracle/OpenOutreach)

**Evidence:** [README](https://github.com/eracle/OpenOutreach/blob/main/README.md) · [lead-finding skill](https://github.com/eracle/OpenOutreach/blob/main/skills/find-leads/SKILL.md) · [license](https://github.com/eracle/OpenOutreach/blob/main/LICENCE.md). **License / last commit / Worker:** GPL-3.0 / 2026-10-23 / No — Python CLI and provider-backed B2B lead workflow. **Vantage map:** adjacent audience in [opportunity generation](../../lib/opportunities/run.ts), but not a posting or outreach feature. **Decision:** **Borrow (idea only)** — it does better at finding person-level B2B contacts from a licensed data source, explaining ICP fit, and delivering a bounded CSV. Vantage does better at surfacing public community conversations and their evidence in a workspace; it never emails, posts, or sends an outreach message. Do not adopt its mail-sending path or copy GPL code. **Effort:** S. **Approx. call cost / AI spend:** data-provider lookup and LLM evaluation costs are provider-dependent; outbound email would add a separate charge and is explicitly out of scope. No comparable per-lead price is published in the reviewed README.

## Top five actions, ranked

Ranking favors the active Vantage work, measurable quality/cost safety, and reuse of existing providers and test surfaces. The issue bodies below are drafts to paste later; **no issues were created**.

### 1. Bound research before expensive retrieval — M

Inspired by Lurk’s staged fetch, Consensus’s per-stage ceilings, and the research-agent separation of plan and evidence; map to #120/#121. Run cheap discovery first, triage candidate metadata, hydrate only the strongest candidates, and apply one explicit budget/time boundary per stage. Paid work must continue through `runPaidCall`; page retrieval must use Firecrawl or an already approved provider, never raw scraping in Workers. **Expected spend:** lower or bounded provider/model spend, with no new inference required for the gate.

**Draft issue title:** `feat(research): enforce staged, budget-bounded retrieval`

**Draft issue body:**

```markdown
## Goal
Bound research cost and runtime by screening candidates before fetching full pages or asking a model to analyze them.

## Scope
- Define explicit candidate limits and a deadline for discovery, triage, and hydration.
- Hydrate only candidates that pass the cheap relevance gate; preserve source URLs and timestamps.
- Route every paid provider request through `runPaidCall` with an estimate, workspace attribution, and provider cap.
- Fetch page content through Firecrawl or an already approved provider; do not scrape pages directly from a Worker.
- Abort promptly on timeout, cancellation, exhausted budget, or provider denial; keep partial results clearly marked.

## Acceptance criteria
- Unit tests prove rejected candidates do not trigger hydration/model calls.
- Tests cover timeouts, denied reservations, cancellation, and partial provider failures.
- Cost records reconcile estimate versus actual provider cost and remain workspace-scoped.
- No posting, scheduling, commenting, voting, or emailing is introduced.
```

### 2. Extend offline relevance evaluation for #139 — M

Use the decision-order checks from AnyJev/Laya and the holdout discipline already present in [learning evaluation](../../lib/learning/evaluate.ts). Add stable fixture cases for relevant, irrelevant, ambiguous, duplicated, and hard-negative conversations; compare the baseline and discovery gate at the daily shortlist boundary. **Expected spend:** neutral; use deterministic fixtures and existing metrics by default.

**Draft issue title:** `test(scoring): add a frozen relevance set for the discovery gate`

**Draft issue body:**

```markdown
## Goal
Make the #139 agent-discovery/relevance gate measurable against a fixed, reviewable set of conversations.

## Scope
- Add privacy-safe fixtures for strong fit, weak fit, ambiguous intent, duplicate evidence, and hard negatives.
- Record expected labels and concise reasons; keep train/tuning and holdout examples separate.
- Report precision@5, NDCG@5, low-confidence rate, and baseline-versus-gate rank changes using the existing offline evaluation surface.
- Test candidate-order and wording perturbations so equivalent choices do not produce unstable results.

## Acceptance criteria
- Default evaluation runs offline with no paid provider or model calls.
- Regressions and threshold/status changes are visible and fail the relevant test.
- Fixtures include enough source context to verify why each expected label is correct.
- Human review remains required for uncertain cases; no automated community action is added.
```

### 3. Save source-backed content drafts as workspace artifacts — M

Use Vantage’s existing research cards and saved-artifact storage rather than a second chat framework. Drafts should carry the source URL/document ID that supports each factual claim, support Markdown export, and remain workspace-scoped. **Expected spend:** neutral if grounded in existing research; otherwise model-token cost is variable.

**Draft issue title:** `feat(content): save source-backed drafts to the workspace library`

**Draft issue body:**

```markdown
## Goal
Turn a confirmed research brief into an editable, source-backed draft that can be saved and exported without publishing it.

## Scope
- Support the planned content formats (blog, X, LinkedIn, Reddit, Hacker News, and newsletter) as editable draft types.
- Keep source URLs and document IDs with the draft; show evidence beside claims and flag claims without support.
- Save/list/delete drafts through workspace-authorized artifact paths and add Markdown export.
- Reuse the existing AI SDK streaming and workspace artifact patterns.

## Acceptance criteria
- Cross-workspace reads and deletes are rejected by tests.
- A draft can be edited, saved, reopened, and exported with its evidence links intact.
- Missing or contradictory evidence is surfaced instead of silently invented.
- Vantage does not publish, schedule, comment, vote, or email the content; any later calendar handoff remains user-controlled (for example, pendpost).
```

### 4. Capture brand voice and humaniser rules in one draft pass — S

Combine Humanizer’s meaning-preserving rewrite rules with the copywriting skills’ product-context and claim-evidence questions. Store user-approved voice guidance, run deterministic checks for generic patterns/unsupported claims, and include the rubric in the existing draft call rather than adding a paid second pass. **Expected spend:** neutral if consolidated; higher if a separate generation is introduced.

**Draft issue title:** `feat(content): add an editable brand-voice profile and humaniser rubric`

**Draft issue body:**

```markdown
## Goal
Let a founder capture their voice once and use it to improve drafts without changing facts or inventing claims.

## Scope
- Capture preferred tone, audience language, phrases to avoid, and approved product proof points.
- Add a humaniser rubric that preserves meaning, source citations, and the founder’s supplied voice.
- Flag generic phrasing and unsupported absolutes in deterministic checks where possible.
- Use the existing metered generation path; do not add a second model call by default.

## Acceptance criteria
- Tests prove the rewrite cannot add a new fact, name, number, date, quote, or citation.
- The user can edit the profile and original/final text before saving.
- Humanisation is not framed as detector evasion.
- No generated text is posted, scheduled, commented, voted, or emailed automatically.
```

### 5. Add evidence-linked weekly topic movement for #99/#136 — M

Borrow the temporal grouping idea from BERTopic and AIHOT, but use Vantage’s current deduplication, vectors, and provider-backed source records. Show what themes are newly rising or cooling with week-over-week counts and representative evidence links; keep grouping explainable and avoid a new LLM call for every cluster. **Expected spend:** neutral or lower if the rollup reuses existing vectors and collected evidence.

**Draft issue title:** `feat(trends): show evidence-linked weekly topic movement`

**Draft issue body:**

```markdown
## Goal
Help a founder see which audience questions are gaining or losing momentum across linked content.

## Scope
- Group same-workspace evidence with existing dedupe/vector features.
- Compare current and prior weekly counts by topic and source; distinguish new evidence from older carry-over.
- Show representative source links, dates, and the counts behind each movement.
- Keep the initial rollup deterministic and bounded; reuse existing provider content rather than scraping from Workers.

## Acceptance criteria
- Tests cover new, rising, stable, cooling, duplicate, and empty topics.
- Every displayed trend links to evidence in the same workspace.
- Missing source dates and partial provider results are labeled honestly.
- The initial implementation adds no per-topic model call and does not publish or send content.
```

## Recommendation in one sentence

Prefer small, evidence-backed improvements to the current Worker-native pipeline and content workspace over importing full research, evaluation, chat, or scraping platforms; retain provider budgeting, human review, and the no-posting boundary.
