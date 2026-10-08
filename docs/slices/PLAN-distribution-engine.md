# Plan: from conversation monitor to developer-tool distribution engine

**Status:** proposal, 7 Oct 2026. Needs owner sign-off on the decisions in section 9 before any slice starts.
**Builds on:** `README.md` (slice contract, money/risk rules), `DECISION-2026-10-07-login-first-usage-billing.md` (credits at cost + 20%), S13/S14 (collectors), S30 (rules index), S31 (reply briefs), S33 (never-posts guard), S46 (attribution).

## 1. What changes, in one line

Today: `sources → documents → opportunity → draft/brief`.
Target: `signal → opportunity (typed situation) → play (recommended GTM action) → human execution → outcome → learning`.

This is not a new system. Every arrow already has a table; the plan adds the missing ones and makes each one more specific.

| Stage | Exists today | Adds |
|---|---|---|
| Signal | `document`, collectors, `lib/pipeline/intent-ladder.ts` (5 regex rungs) | situation classifier (S70), vendor change watch (S74) |
| Opportunity | `opportunity` (+ `features` jsonb, `score`, `urgency`) | `situation`, requirements match, risk, decay (S70, S71) |
| Play | none (`recommendedAction` is free text) | `play` table: typed action with target, cost and expected effort (S72) |
| Destination | none | `destination` catalog + `workspace_destination` fit (S75, S76) |
| Execution | `opportunity_draft`, `reply_brief` (S31) | outreach brief for earned links (S77); never sends |
| Outcome | `opportunity_outcome` (`utm_click`, `conversion`, `published_url`) | tracked links per play/destination, funnel stages (S73) |
| Learning | `workspace_preference_model` (per workspace, aggregate-only) | play/destination performance by product cohort (S79, later) |

## 2. What I changed from the original proposal, and why

1. **Split facts about a destination from facts about a product on that destination.** The proposal listed 11 fields per destination, mixing global facts (free/paid, requirements, backlink type, editorial vs automatic, submissions open) with per-product facts (relevance, referral traffic, conversions, "worth doing"). Global facts belong in one curated, dated catalog shared by every workspace (like `community_rule`). Per-product facts live in `workspace_destination`. Otherwise every workspace re-verifies Product Hunt.
2. **Six scores become one ranked score with a visible breakdown.** `opportunity_value`, `reply_value`, `product_fit`, `commercial_intent`, `community_risk` and `time_decay` give false precision and no user can act on six numbers. Keep them as components in the existing `opportunity.features` jsonb, rank by one `score`, and show the two components that drove it ("high intent, low promotion tolerance"). Community risk is a **gate**, not a weight: it changes the recommended action (brief only, no link) instead of lowering the rank.
3. **"Matches 4/5 requirements" only when every requirement has a doc citation.** Extract requirements from the post, match each against the product's docs with the existing claim-support logic (`lib/drafting/generate.ts`). Unmatched requirements show as "not found in your docs", never "missing". If fewer than 2 requirements are extracted, show no ratio.
4. **Attribution is honest about what Vantage can see.** Vantage cannot see a customer's analytics. v1 = tracked links (UTM + short redirect on Vantage's domain, counted as `utm_click`) plus manual or CSV entry for signups, activations and paid. Analytics imports (PostHog, Plausible, GA4) come later, read-only. "317 visits, 42 trials" only appears when the data came from one of those sources, labelled with the source.
5. **Expected cost comes from the cost ledger, not an estimate.** A play's cost is the sum of `cost_event` rows it caused (classification, scrapes, brief generation) plus a separate, user-entered "your time". Don't show "$18" unless it was recorded.
6. **Cut the GTM Coverage Score from V1.** A single number before there is outcome data is a vanity metric and invites gaming. Ship the inputs first (destination coverage checklist in S76). Revisit the score after 90 days of outcome data (S79), and only publish a score whose components correlate with observed signups.
7. **Defer `/deals` and the launch radar property.** It is a separate editorial product with its own audience-building problem. Validate it first as a manual weekly list sent by the owner (no code) and build only if it reaches a stated threshold (section 8).
8. **Automatic directory submission: never in this plan.** Same reason as the never-posts promise: it moves Vantage from "advice" to "acts on third-party platforms", it is the commodity part, and many directories ban automated submissions. Vantage prepares a submission kit (copy, screenshots, category, tags) the founder pastes in.
9. **Earned links: the guard extends to email.** Outreach drafts are briefs, not sent mail. Contacts are only public editorial/submission addresses or forms listed by the site itself; no email finding, no enrichment, no scraping personal addresses (privacy law and spam risk). S33's guard test adds SMTP/email-API hosts.
10. **Cross-workspace learning is opt-in and aggregate-only.** "For open-source TypeScript devtools, DevHunt beats Product Hunt" needs a product taxonomy and a minimum cohort (at least 5 workspaces, at least 20 outcomes) before any number is shown. It reuses the raw-content leakage check from `lib/learning`.
11. **Dogfood first.** Vantage is a developer tool launching in early December. Its own launch (S61) is the first Distribution Graph customer; the curated catalog gets its first verified rows from that work.

## 3. Sequencing against the calendar

The Reddit deadlines (31 Oct, 13 Nov, 30 Nov) and the early-December launch still come first. This plan does not displace S10, S11, S12, S21 or S31.

| Window | Do | Why then |
|---|---|---|
| Now to 31 Oct | S70 (situation classifier). It is pure library code with no new sources, and it improves every existing opportunity | Small, no human gates, raises quality of the radar scan that launches in November |
| 1 to 30 Nov | S75 (destination catalog + public "where to launch a dev tool" pages), seeded by the owner while preparing Vantage's own launch | Doubles as SEO/GTM content for Vantage, like S16 and S30 |
| Dec (after launch) | S71, S72, S73, S76 | Needs S31 briefs and S46 attribution in place |
| Jan | S74, S77, S78 | Needs S13 (GitHub) and Browser Run page watching |
| After 90 days of outcomes | S79 | Needs data |

## 4. Situation classifier (V1 priority 1)

Replace the 5-rung intent ladder's single number with a **situation** (what is happening) plus intent strength. Situations, each with an example trigger:

| Situation | Example | Default play |
|---|---|---|
| `tool_request` | "What tool can do X?" | brief: answer, link if venue allows |
| `alternative_request` | "Alternative to X?", "open-source alternative?" | brief + comparison page + alternatives directories |
| `price_pain` | "X got too expensive", "we're paying too much for" | brief + pricing comparison; watch for clustering into a migration event |
| `migration` | "I'm migrating away from X" | migration guide/importer play |
| `integration_gap` | "Does anything connect A and B?" | brief; counts toward integration play (S78) |
| `built_it_myself` | "I built this manually because nothing exists" | brief; product/feature evidence |
| `free_tier_request` | "Free tier/trial?" | brief; trial offer play |
| `breakage` | "X just broke/removed feature Y" | brief; time-sensitive (fast decay) |
| `how_solved` | "How are people solving X?" | brief, education angle, no link by default |
| `evaluation` | "Evaluating A vs B vs C" | brief + comparison |
| `team_need` | "Our team needs..." | brief; higher commercial weight |
| `production_check` | "Anyone using X in production?" | brief only if the user has real production evidence (case study in docs) |
| `other` | everything else | ranked by existing features |

Design:
- **Two stages to keep cost near zero.** Stage 1: deterministic patterns (extend `intent-ladder.ts`, keep it pure) tag a candidate situation and drop noise. Stage 2: only candidates above a threshold go to one model call through the AI Gateway, which returns `{situation, requirements[], named_tools[], budget_signal, team_signal}` as JSON. Every call goes through `recordCost()` and the source switch for the model provider. Cache by document hash.
- **Score:** `score = fit x intent x freshness`, where `freshness` decays with a half-life per situation (`breakage` 2 days, `alternative_request` 7 days, `how_solved` 30 days). Venue risk from S30 (`allows_promotion`, `bans_ai_text`) sets the action mode: `link_ok`, `link_if_asked`, `no_link`, `brief_only`.
- **Output card** (what the user sees), example:
  > **Alternative request, high intent.** Developer wants to replace a $150/month observability tool because it lacks OpenTelemetry export. Matches 3 of 4 stated requirements (cited from your docs); "SOC 2" not found in your docs. Venue: r/devops, promotion limited. **Do:** answer the OpenTelemetry question; link only if asked.

Acceptance: labelled fixture set of at least 150 real public posts (owner-labelled, 10+ per situation), stage-1 recall at least 0.9 on non-`other` labels, stage-2 macro-F1 reported in the PR; no situation shown below a stated confidence; cost per 1,000 documents recorded.

## 5. Distribution Graph (V1 priority 2)

### Data model (additive migrations)

`destination` (global, curated; mirrors `community_rule`):
`id, slug, name, url, kind (launch_platform | directory | ai_directory | devtool_directory | marketplace | newsletter | alternatives_site | awesome_list | resource_page | community | podcast), audience_tags text[], category_tags text[], cost (free | paid | freemium | unknown), price_note, listing_mode (editorial | automatic | review_queue | unknown), requirements jsonb, submissions_open (yes | no | rolling | unknown), submission_url, link_attr (dofollow | nofollow | ugc | none | unknown), ai_cited (yes | no | unknown) + ai_cited_evidence, source_url, last_verified date, verified_by, notes`.
Unknown is always allowed and preferred over guessing. `ai_cited` is only `yes` with a recorded example (query, engine, date).

`destination_change` (pending/accepted/rejected), same pattern as `community_rule_change`. Re-check via `browserMarkdown` weekly; never auto-publish.

`workspace_destination` (per workspace): `workspace_id, destination_id, fit real, fit_reasons jsonb, recommendation (do_now | do_later | skip), status (suggested | planned | submitted | listed | rejected | dismissed), listed_url, submitted_at, listed_at, tracked_link_id`. Outcomes come from S73, never typed in here.

### Fit ranking (deterministic first)

`fit` = category/audience tag overlap with the monitoring profile + requirement eligibility (open-source only, has GitHub integration, is an extension, is AI) + observed outcome prior (S79, zero until data exists). One optional model call writes the one-line "why this fits / why skip". Output is the **top 10 to 20** with an explicit "probably skip" list, so the user sees why the long tail was cut.

Marketplaces are eligibility-gated, not ranked: GitHub Marketplace only if the product is a GitHub App/Action; VS Code / JetBrains / Open VSX only if it ships an extension or plugin; otherwise they move to the integration play (S78) as "would open this channel".

### Seed

40 to 60 hand-verified rows, not 500. Start with the ones the owner actually uses for Vantage's launch (Product Hunt, DevHunt, Hacker News Show HN, SaaSHub, AlternativeTo, Futurepedia and similar AI directories, BetaList where eligible, GitHub Marketplace, VS Code Marketplace, Open VSX, JetBrains Marketplace, relevant awesome-lists, devtool newsletters with public submission forms). Every row needs a primary-source URL and `last_verified`.

### Public pages (doubles as Vantage's own SEO)

`/launch` (where to launch a developer tool) and `/launch/[slug]` ("Is DevHunt worth it for a developer tool?": requirements, cost, listing mode, link type, last verified). Same SEO rules as S16/S30.

## 6. Earned links and integration plays (V1 priority 3, after launch)

Opportunity types, each with evidence attached:
- "Best X tools" / "alternatives to X" pages that list competitors but not the product (search + `browserMarkdown`, checked against the profile's competitor names).
- Stale comparison articles (last updated more than 12 months ago, or mentions a deprecated competitor plan).
- Awesome-lists and ecosystem/resource pages in the product's category whose contribution guidelines allow additions (read CONTRIBUTING; skip if it bans self-submission).
- Integration docs pages of complementary tools that list compatible integrations.
- Newsletters and podcasts with a public submission process.
- Broken or outdated resource links where the product is a genuine replacement.

Each becomes a `play` with an **outreach brief** (S77): why this page, what's missing, the one fact that justifies inclusion (cited from the user's docs), the site's own submission rules, the public contact or form, and a "don't" list. No ready-to-send email body for sites that ask for none; for sites with a form, a field-by-field kit. Vantage never sends.

**Integration play (S78):** when at least N distinct authors (default 5, across at least 2 platforms, within 60 days) ask to connect tool A with tool B, and the user's product is A or B (or the bridge), and the other side has a marketplace or integrations page, recommend building the integration. The card lists the evidence threads, the target marketplace's listing requirements (from `destination`), and what it would unlock (listing, partner page, docs backlink).

## 7. Plays and attribution

`play`: `id, workspace_id, opportunity_id null, destination_id null, kind (reply_brief | directory_submission | comparison_page | migration_guide | importer | integration | outreach | trial_offer | newsletter_pitch), title, rationale, evidence jsonb, status (suggested | accepted | done | dismissed), effort_estimate (s | m | l), created_at, done_at`.

`tracked_link`: `id, workspace_id, play_id, slug, target_url, utm jsonb, created_at`. Redirect route `/r/[slug]` writes `utm_click` into `opportunity_outcome` (extend with nullable `play_id`; no IP or user agent stored, only a daily count and referrer host). Funnel stages beyond the click (`signup`, `activated`, `paid`) are entered manually, by CSV, or later by analytics import, and each row records its source.

Migration-event plays (S74): when `price_pain` + `migration` documents mentioning the same vendor cross a threshold within 14 days, or a watched pricing/changelog page changes, Vantage groups them into one opportunity with per-platform counts and proposes the play bundle (migration guide, importer, alternative page, relevant directories, newsletter pitches, briefs for open threads, trial offer). Each play in the bundle is accepted or dismissed separately.

## 8. Launch radar and `/deals`: validate before building

Manual test (owner, no code): a weekly "new developer tools worth trying" list for 6 weeks, curated by hand, with stated inclusion rules (working product, real free tier or trial, clear developer use, editorial approval, disclosure when a Vantage customer is included). Build the property only if it reaches **300 subscribers and 3 tool makers asking to be included** by the end of the test. Customer inclusion must never be paid placement without a "sponsored" label.

Trial-offer plays (inside the product) are fine earlier: they are just a `play.kind = trial_offer` recommendation triggered by `free_tier_request` and `price_pain` clusters.

## 9. Decisions for the owner

1. Approve the sequencing in section 3 (nothing here before the 31 Oct Reddit work), or name what it should displace.
2. Free basic scan: include the top 5 Distribution Graph destinations (cheap: catalog lookup plus one model call) as part of the lead magnet? Recommended yes; it shows value without needing collected conversations.
3. Accept "never auto-submit, never send outreach" as a product promise alongside "never posts".
4. Opt-in for cross-workspace learning (default off) and the minimum cohort sizes in section 2.10.
5. Who verifies catalog rows (owner, or contractor with owner spot-check), and the re-verification interval (proposed 90 days; flagged stale after that).

## 10. Slices

| ID | Slice | Size | Depends on | Notes |
|---|---|---|---|---|
| S70 | Situation classifier (two-stage), labelled fixtures, score with decay and venue action mode | M | S30 (venue mode; fall back to `unknown` without it) | Pure lib + migration for `opportunity.situation`; existing UI shows the card |
| S71 | Requirement extraction and doc-cited match | M | S70, S31 | Reuses claim support; no ratio below 2 requirements |
| S72 | `play` table, play cards on opportunity page, accept/dismiss | M | S70 | Replaces free-text `recommendedAction` going forward |
| S73 | Tracked links, `/r/[slug]`, funnel entry (manual + CSV), per-play results | M | S72, S46 | Privacy note; no IP/UA |
| S74 | Migration-event clustering + vendor pricing/changelog watch | L | S70, S72, S13, S07 | Browser Run only for permitted pages |
| S75 | Destination catalog, change queue, seed 40 to 60 rows, `/launch` pages | M | S07 (re-check), owner verification | First used for Vantage's own launch |
| S76 | Per-workspace destination fit, top 10 to 20 with skip list, submission kit | M | S75, S72 | Eligibility gates for marketplaces |
| S77 | Earned-link finder + outreach briefs; extend S33 guard to email hosts | L | S72, S31, S33 | Public contacts only |
| S78 | Integration play from co-mention clusters | M | S70, S72, S75 | Thresholds configurable |
| S79 | Cohort learning + coverage view (score only if validated) | L | S73 with 90 days of data | Opt-in, aggregate-only |

Each slice follows the contract in `README.md` section 2 (one PR, additive migrations, tests without network, `recordCost` on every model/scrape call, source switches, never writes to third-party platforms).

## 11. How we know it worked

- Situation classifier: share of opportunities marked `useful` rises from the current baseline (measure the baseline from `opportunity_outcome` before S70 ships).
- Distribution Graph: at least 60% of the top-10 destinations accepted (`planned` or better) by the first 10 workspaces; at least one listing per workspace producing a tracked click within 30 days.
- Plays: at least 30% of suggested plays accepted; cost per accepted play under $0.10 from the ledger.
- Kill or rework any module that misses its target after 60 days of real use.

## 12. Easy to forget (not in either earlier proposal)

1. **AI-native distribution surfaces.** For AI dev tools in 2026 these often matter more than classic directories: the official MCP Registry and MCP directories, Claude Code plugin marketplaces and skill collections, Cursor/Windsurf rule and extension directories, OpenRouter app listings, Hugging Face Spaces, and deploy templates on Vercel, Cloudflare, Railway and Netlify. Add them as `destination.kind = agent_registry | template_gallery`, gated on eligibility (ships an MCP server, a skill, a template). Vantage's own S50/S51 are the first test.
2. **AI answer visibility.** Developers increasingly ask ChatGPT, Claude or Perplexity "what's the best X". A small monthly panel of category prompts per workspace (bounded, priced through the ledger, results dated) tells the user whether they are named, who is named instead, and which pages those answers cite. Those cited pages feed the earned-link finder (S77). Show "not named in 8 of 10 prompts on 3 Nov", never a made-up score. Add `llms.txt` and docs-readability checks as cheap plays.
3. **Self-reported attribution.** Most community traffic arrives with no referrer ("dark social"). A one-question "where did you hear about us?" field at signup, with the user's answers imported into S73, will explain more than UTM links. Recommend it in onboarding and give the snippet.
4. **Your own mentions, not just prospects.** Bug reports, complaints, "is this still maintained?" and questions about the user's own product are retention and docs signals. Classify them as `own_product_support` and `docs_gap` (the same question asked 3 or more times becomes a "write this docs page" play).
5. **Suppression as a first-class output.** From the first half of the conversation: the product must say "don't engage" with a reason (saturated thread, weak expertise fit, too many replies from you in this community this week, venue bans promotion). Track a per-user, per-community cadence in the S32 contribution ledger and suppress above it. Stack Overflow is discover-only: no draft, no brief prose, only the question and primary-source evidence.
6. **Honest empty coverage everywhere.** Every count shown (situations, migration events, AI visibility) carries `coverage_status` per source (`checked | unavailable | failed | unsupported`). Zero results from a failed source never read as "no demand".
7. **Legitimate paid channels.** Labelled newsletter and podcast sponsorships are fine and often the best spend for dev tools. Add `destination.kind = sponsorship` with audience, price and a cost-per-click field filled from S73 results, so users can compare paid and earned channels on the same ledger.
8. **Things Vantage should refuse to recommend:** link exchanges or link buying (Google spam policy), upvote or engagement rings, bought GitHub stars, incentivised or fake reviews (the US FTC rule on fake reviews, in force since Oct 2024), sockpuppet accounts, and undisclosed affiliation. Document this on the `/promise` page (S33).
9. **Delivery.** The engine only works if people see it: a weekly digest (email first; Slack later) with the top 3 opportunities, top 3 plays and one "skip this" explanation. Without it the outcome loop never fills.
10. **Data handling.** Store author handles only as long as the opportunity is open (default 90 days), honour deletion requests, and keep per-source terms (TinyFish, X, Reddit, Stack Overflow licensing) in `platform_status` (S16) so each source states what is a verified contract and what is an assumption.
