# Unified GTM, SEO, GEO and Content workspace

Date: 21 Oct 2026. Status: requirements captured from Liam; implementation and research-provider selection pending.

## Product direction

Merge the GTM workspace and `/seo` experience into one chat-first workspace. The uploaded Capy screenshot is a reference for the sidebar, bottom composer and finish-setting-up visual, not a request to reproduce Capy's branding.

- Persistent sidebar tabs: GTM, SEO, GEO and Content. GTM exposes opportunities, sources and outcomes. Settings and chat history remain accessible without competing with the main tabs.
- A persistent multiline AI composer sits at the bottom of every tab.
- The assistant guides the user through a journey rather than expecting them to invent questions. Always show exactly three contextual next actions, including on an empty conversation and after a completed answer. Mark one recommended and explain why it advances the user's current goal.
- Next actions reflect the product profile, active tab, conversation findings and missing information. They must not be three generic category questions. The freeform composer remains available.
- Selecting a next action continues the journey. Paid lookups retain explicit cost information and existing approval requirements. A recommendation never authorizes paid work or publishing by itself.
- The conversation is text-led with inline rich evidence: rendered forum messages and subtle animations for GTM; charts, tables and citations for SEO/GEO; briefs, outlines and draft views for Content. Keep source links, sample-data labels, keyboard access and reduced-motion support.
- Evidence can also be inspected beside the conversation; narrow screens must retain access without requiring a side-by-side layout.
- Content is a dedicated blog-workflow page, not merely a research category. The boundary between planning, saved drafting, editing and publishing still needs confirmation.

## Deep research and current knowledge

Add a research capability for SEO/GEO news, Google changes, case studies and practical insights. Separate ongoing source monitoring from expensive deep investigation: authoritative feeds identify changes, and research investigates relevant changes and conflicting claims.

- Prefer Google's Search Central documentation, blog and Search Status Dashboard for confirmed Google changes. Distinguish official announcements from observed correlations, practitioner interpretation and unverified GEO claims.
- Store the source URL, publication/update date when available, retrieval date, supporting passages and limitations. Show freshness and citations in answers; do not invent publication dates or causal conclusions.
- Deduplicate findings, retain provenance and supersession history, and retrieve relevant evidence into workspace answers and recommended next actions. Shared public research must not contain private workspace data.
- Research jobs must be asynchronous and durable for the Cloudflare runtime, with bounded spend, explicit failure states and provider credentials held server-side. Do not run multi-minute research inside a normal chat HTTP request.
- Choose a provider using benchmark evidence plus a task-specific evaluation, not general model rankings alone. Compare citation entailment, fresh-source retrieval, primary-source coverage, unsupported claims, relevance, latency, API availability and cost per useful report.

### Initial benchmark check

Checked 21 Oct 2026; no paid evaluation or provider integration has run.

- [DeepResearch Bench](https://deepresearch-bench.github.io/) evaluates 100 tasks across 22 fields. Its published early-agent comparison reports Gemini 2.5 Pro Deep Research at 48.88 overall versus OpenAI Deep Research at 46.98; Perplexity leads citation accuracy among those deep-research agents at 90.24%. These are historical model versions, not evidence of today's best API.
- [Valyu's DeepResearch announcement](https://www.valyu.ai/blogs/introducing-deepresearch) reports a vendor-run DRACO comparison: Valyu Heavy 72.7%, Perplexity Deep Research 70.5%, Gemini Deep Research 59.0%. Treat these as vendor claims requiring reproduction, not independent rankings. It advertises fixed per-task tiers: Fast $0.10, Standard $0.50, Heavy $2.50, Max $15; reconfirm pricing and terms before adoption.
- [Parallel's benchmark report](https://parallel.ai/blog/deep-research-benchmarks) uses a win-rate-versus-reference metric. Do not compare that percentage directly with DRACO or DeepResearch Bench overall scores.

Evaluation shortlist: current API-accessible offerings from Google, OpenAI, Perplexity, Parallel and Valyu. Verify exact model/version availability, data handling and pricing before running the same SEO/GEO tasks against each. No winner selected yet.

Liam subsequently confirmed existing Perplexity API access and Vercel AI Gateway. Perplexity is the initial research candidate, pending comparison with Gemini; Sol is the proposed independent findings/source reviewer. Verify exact Gateway model support separately from provider-specific deep-research APIs. Research and review remain separate responsibilities.

## Finish setting up

Add a dismissible, resumable sidebar setup panel with progress and concrete next actions:

1. Set up the product profile.
2. Connect Google Search Console.
3. Find the first leads.
4. Write the first blog post.

Completion must come from real workspace state, not clicks or local-only toggles. Returning users resume unfinished work, and each item opens the appropriate tab or connection flow. Dismissing the panel does not erase progress; users can reopen it. Missing GSC access must not block GTM or content work.

Google Search Console requires a real integration: OAuth with the least-privilege `webmasters.readonly` scope, property selection, workspace-scoped connection state and data, secure token handling, disconnect/reconnect, and initial-sync status. Mark connection complete only after a usable property is authorized; show data readiness separately. Never render tour fixtures as connected account data.

References: [Search Console authorization](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing), [Google Search Status Dashboard](https://status.search.google.com/summary).

## Verified current implementation boundaries

- `/queue` lists opportunities; `/seo` hosts a persisted SEO/GEO/content-planning assistant. Both already use the workspace monitoring profile.
- `app/seo/chat-client.tsx` renders starter prompts only for an empty chat and follow-ups within answers; it does not yet provide a persistent three-action journey.
- The existing SEO agent classifies out-of-scope requests and has no GTM tool integration. Renaming the UI alone would not create a unified assistant.
- The SEO agent's existing design explicitly defers full blog drafting. Content research is not a saved blog workflow.
- Search Console appears as labelled sample data in `/tour`; no live GSC integration was found in `app` or `lib` during this inspection.

## Delivery checkpoints

1. Confirm remaining Content scope and review the unified interaction design.
2. Build the workspace shell, tab navigation, bottom composer, rich evidence and three-action journey while preserving conversation history, authorization and paid-call approvals.
3. Add scoped GTM assistant tools and the agreed Content workflow, with query-boundary tests.
4. Implement GSC and state-backed setup milestones.
5. Run the research-provider evaluation, select a provider and integrate durable research plus sourced knowledge retrieval. Research cadence and spend ceilings need approval before enabling recurring jobs.
6. Verify with repository lint, typecheck, tests, build, Worker tests and real browser journeys; show the final rendered UI. No production activation, publishing or merge is implied by this design.

## First implementation slice

Liam asked to start with GTM and proceed down the list. The first slice adds `/workspace`, a persisted read-only GTM assistant over current workspace opportunities, three contextual next questions with the first recommended, a bottom composer and source-message evidence beside the conversation. The existing queue, detail and source-management pages remain available. SEO/GEO links still open existing research; the dedicated Content workflow and GSC are explicitly marked as later work.

This first assistant advises from existing evidence; it does not run scans, post replies, write blog drafts or execute suggested actions. GTM currently shares the existing SEO assistant question allowance, disclosed in the composer. No schema migration is introduced.

The initial setup panel reflects the current profile and current opportunity queue, not durable lifetime milestones. Persistent dismissal, historical lead completion, GSC connection and blog completion remain follow-up work. Live end-to-end verification needs the local database, Neon Auth and AI Gateway environment configured.

## Shared design correction

Liam rejected the old `/tour` and requested that all other pages match `/workspace`. The workspace frame is now shared by the live assistant, click-driven demo and all workspace-scoped Shell consumers, including opportunities, sources, profile, research, digest and plan settings. Public Shell consumers use matching typography, surfaces, borders and actions, including the landing page, auth, pricing, blog and launch catalog. A dedicated Content entry explains what research can do today without claiming a saved blog workflow exists.

The tour replaces the pinned scroll presentation with selectable GTM/SEO/GEO/Content sample lanes and three sample next actions. Public content remains public; no authorization boundary or paid-call approval is bypassed for presentation verification.
