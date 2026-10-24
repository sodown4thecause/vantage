---
source: perplexity/sonar-deep-research
date: 2026-10-22
topic: seo-geo-monthly
---

# Research briefing: SEO + GEO for developer-tool startups

**Cut-off:** **2026-10-22**. **Window:** **2026-04-22–2026-10-22**.  
**Evidence labels:** **[confirmed]** = official announcement/documentation or primary data; **[reported]** = third-party measurement or observation. All dates are publication, announcement, rollout, or measurement dates.

## 1. Google search changes: core/spam/helpful-content updates, AI Overviews / AI Mode, Search Console

### Ranking updates — newest first

| Name | Dates and rollout length | Scope | Who won / lost |
|---|---|---|---|
| **September 2026 spam update** | **2026-09-24–2026-10-08; 13 days 16 hours** **[confirmed]** | Global, all languages; Google disclosed no targeted policy or query share. [386] | **2026-10-15 [reported]:** DiscoverCars’ sample of 178 blogs was almost evenly split—91 gained estimated organic traffic and 84 declined—so there is no robust sector-wide winner profile. **2026-10-17 [reported]:** one mostly-small-business analytics sample found 5.8% of sites lost at least half of unpaid Google visits during rollout versus 1.3% in non-update weeks, but its windows were not like-for-like. [88][451] |
| **August 2026 spam update** | **2026-08-18–2026-08-21; 2 days 16 hours** **[confirmed]** | Global, all languages; Google did not officially identify the particular spam policies involved. [390] | **2026-08-31 [reported]:** Glenn Gabe documented an ultra-YMYL site with more than 1.5 million indexed URLs and extensive programmatic content losing rankings for over 200,000 queries; impacts also reached AI Overviews and AI Mode. **2026-08-20 [reported]:** other monitoring found isolated gains/losses rather than universal disruption. [452][83] |
| **June 2026 spam update** | **2026-06-24–2026-06-26; 2 days 1 hour** **[confirmed]** | Global, all languages; no policy-specific target was published. [382] | **2026-06-26 [confirmed]:** Google supplied no winner/loser data. **As of 2026-10-22 [reported]:** no sufficiently credible public sector analysis separates this short rollout from ordinary volatility, so evidence is thin. |
| **May 2026 core update** | **2026-05-21–2026-06-02; 11 days 21 hours** **[confirmed]** | Google called it a regular core update intended to surface relevant, satisfying content from all types of sites; no specific classifier or vertical target was disclosed. [61][63] | **2026-05-26 [reported]:** SISTRIX tracked 8,887 domains and counted 5,039 gaining versus 3,845 losing at its interim checkpoint, while warning that coincident movement is not necessarily caused by the update. **2026-05-29 [reported]:** German winners included Shop-Apotheke +50.7%, Coolblue +43.6% and HubSpot +41%; comparison/aggregator-style content and UK news showed net weakness in SISTRIX analyses. [75][76][453] |

- **2026-10-22 [confirmed]:** Google had announced **no October core update** by the cut-off; the official dashboard showed no active incident. Reports of volatility on October 20–21 were therefore unconfirmed. [363][17]

- **2026-10-22 [confirmed]:** there was **no separately named “helpful content update”** in this six-month window. Google’s current documentation says its automated ranking systems prioritize helpful, reliable, people-first information; “helpful content” should be treated as an ongoing quality objective rather than a discrete recover-at-the-next-HCU event. [66]

### AI Overviews and AI Mode — newest first

- **2026-10-15 [confirmed]:** Google increased inline links and moved them higher in AI responses, began testing a top-of-answer section for one or two official pages, expanded timely-article carousels and Preferred Sources, made end-of-answer article links more visual, and began testing clickable creator/publisher profiles in AI Mode. This raises the value of being the unambiguous official destination for documentation, downloads, pricing and account actions. [30]

- **2026-10-02 [confirmed]:** Google’s owner guidance states that AI Overviews and AI Mode can perform **query fan-out** across related subtopics and data sources. Eligibility still requires normal Google indexing and snippet eligibility; Google says there is no special schema, AI markup or machine-readable file required. [36]

- **2026-07-22 [confirmed]:** Alphabet reported more than **1 billion monthly AI Mode users** and said AI Search features were sending billions of clicks to websites weekly; these are company aggregate claims, not publisher-level traffic evidence. [31]

- **2026-06-03, global by 2026-08-31 [confirmed]:** Google introduced a Search Console switch allowing sites to opt out of grounding and appearing in generative Search features without using that decision as a ranking signal in non-generative results. It also reported more than **2.5 billion monthly AI Overview users** and more than **1 billion AI Mode users**. [42]

- **2026-05-19–2026-05-20 [confirmed]:** Google made Gemini 3.5 Flash the global default AI Mode model and joined AI Overviews to AI Mode so users could move directly into follow-up conversation; AI Mode also gained text, image, file, video and Chrome-tab inputs. [34][43]

- **2026-07-01 [reported, randomized experiment]:** among 1,065 desktop Chrome users studied in early 2026, showing an AI Overview reduced outbound organic clicks **39.8%**, increased zero-click searches **34.5%**, and sent only about **8% of clicks** through AIO citations. This is stronger causal evidence than ordinary CTR correlations, but covers desktop participants and a limited observation period. [46][50]

### Search Console reporting — newest first

- **2026-09-24 [confirmed]:** Search Console added a global **Web: multimodal** filter to normal Performance and generative-AI reports, covering Lens, Circle to Search, image uploads and Chrome’s “Search this image.” It reports affected pages and standard dimensions, but no query dimension because the input is principally visual. [369][368]

- **2026-07-07, global rollout announced 2026-07-29 [confirmed]:** “platform properties” began reporting how verified Instagram, TikTok, X and YouTube content performs in Search and Discover. This is relevant when developer education lives in demos or social posts rather than the company domain. [14][13]

- **2026-06-03, global by 2026-08-31 [confirmed]:** dedicated generative-AI Search and Discover reports began showing **impressions, pages, countries, devices and hourly/daily/weekly/monthly dates**. The data remains part of overall Performance reporting; the initial report did not expose prompt/query text or a dedicated generative-AI click metric. [44]

---

## 2. AI answer engines: source selection, citations, crawlers and `llms.txt`

### How each engine chooses and cites sources

| Engine | Current mechanism and implications |
|---|---|
| **ChatGPT Search** | **2026-10-10–2026-10-22 [confirmed]:** `OAI-SearchBot` supplies ChatGPT Search eligibility; blocking it prevents appearance in answer summaries/citations, although navigational links may remain. ChatGPT can show inline citations plus a Sources panel, and outbound search links carry `utm_source=chatgpt.com`. [90][91][101] **2026-10-15 [reported, academic observation]:** candidates retrieved more consistently over repeated runs were more likely to be cited; ChatGPT also rewrote prompts rather than simply searching their exact text. The study recommends repeated prompt runs and page- plus domain-level measurement. [392][393] |
| **Perplexity** | **2026-10-21 [confirmed]:** `PerplexityBot` indexes pages for search and links, while `Perplexity-User` may live-fetch a page in response to a user. Its Agent API can run multiple searches, return titles/URLs/publication dates in `search_results`, and map answer sentences to numbered references. [120][129][131] **2026-08-11 [reported]:** in 50 B2B software-buying prompts, Perplexity produced almost five times as many citations per answer as ChatGPT and drew 78.3% from comparison/list/review pages; this is a small vendor-run benchmark, not a universal ranking model. [165] |
| **Gemini** | **2026-10-14 [confirmed]:** when Google Search grounding is enabled, Gemini decides whether search would improve the answer, generates one or more queries, processes Search results and returns statement-level URL annotations plus search-result metadata. [136] **2026-03-26 documentation still current at 2026-10-22 [confirmed]:** Gemini Apps’ “double-check” links can be merely similar corroboration and are not necessarily the pages used to generate the answer. [141] |
| **Claude** | **2026-10-07 [confirmed]:** for prompts needing current information, Claude invokes web search, processes multiple live-web sources and returns direct citations, source links and sometimes quotations. **2026-06-02 [confirmed]:** Claude Research can perform multi-source synthesis across the web and connected internal sources. Anthropic does not publish a public web-source ranking formula. [152][155] |
| **Copilot** | **2026-05-19–2026-08-18 [confirmed]:** public-web grounding generates a shortened query from the prompt and sends it to Bing; users can inspect the query and sources in Copilot Chat. Copilot Studio’s broad web search covers public sites indexed by Bing and interleaves them with configured website sources. Therefore Bing crawl/index eligibility is the main public-web prerequisite. [112][105][111] |

### Published or measured citation factors

- **2026-05-25 [confirmed, controlled research]:** *What Gets Cited* ran **252,000 paired trials across six LLMs and 18 factors**. Once two documents were already in model context, topical relevance and source position were the strongest first-citation drivers; explicit price information and a recent timestamp helped consistently; completeness and trust evidence delivered smaller gains; formatting-only edits had little effect. The study tests **selection after retrieval**, not how a page enters an engine’s candidate set. [420]

- **2026-07-29 [reported]:** Pillarbase examined **15,699,298 Google AI Mode citations** across 148 industries. **47.7%** linked to a text fragment; the median selected passage was **117 words**, about 80% answered in its first sentence, and roughly 85% was self-contained. Pages with 21+ cited passages had a median organic rank of #1, but the study explicitly establishes correlation rather than causation. [408][415]

- **2026-08-11 [reported]:** only **21.6%** of 1,576 B2B-software citation occurrences matched a Google top-10 domain in Gadex’s three-engine benchmark—25.8% for ChatGPT, 20.6% for Gemini and 21.0% for Perplexity. Optimizing only the current Google top ten is therefore insufficient for this sample. [165]

- **2026-06-26 [reported]:** Semrush’s 126-million-prompt index found ChatGPT averaging about **15 sources per response**, frequently using community/reference sites, while Gemini averaged about **three** and drew from a narrower pool including Wikipedia, Reddit and YouTube. [164]

- **2026-06-19–2026-08-17 [reported]:** Reddit is volatile rather than a stable “ranking factor”: Promptwatch saw its ChatGPT citation share fall from **3.83%** during July 18–August 7 to **0.52%** during August 14–17. Community participation remains useful for discovery and market evidence, but citation forecasts should not assume a fixed Reddit preference. [298]

### Crawlers and user agents

| Agent/control | Status as of 2026-10-22 |
|---|---|
| **OAI-SearchBot** | **2026-10-10 [confirmed]:** ChatGPT Search crawler; respects its own `robots.txt` token. Current documented example ends in `OAI-SearchBot/1.4`, but OpenAI warns versions change. Allow the published IP ranges as well as the token; robot changes can take about 24 hours. [90] |
| **GPTBot** | **2026-10-10 [confirmed]:** OpenAI foundation-model training crawler, independent of Search eligibility. A startup can allow OAI-SearchBot while disallowing GPTBot. [90] |
| **ChatGPT-User** | **2026-10-10 [confirmed]:** user-triggered fetcher for ChatGPT and custom GPT actions; not the Search crawler, and `robots.txt` may not apply because the fetch is user-initiated. [90] |
| **PerplexityBot** | **2026-10-21 [confirmed]:** search/indexing bot, not a training crawler; allow both its user-agent and current published IP ranges. [120] |
| **Perplexity-User** | **2026-10-21 [confirmed]:** live, user-triggered fetcher; generally ignores `robots.txt`. Perplexity recommends periodically syncing WAF allowlists from its official JSON endpoint. [120] |
| **ClaudeBot** | **2026-04-07–2026-10-13 [confirmed]:** Anthropic documents ClaudeBot as its training crawler; blocking it signals exclusion of future material from training. Anthropic says it respects `robots.txt`. Claude’s public documentation does not establish ClaudeBot itself as the determinant of live-search citations. [157][154] |
| **Google-Extended** | **2026-10-16 [confirmed]:** a robots control, not a separate HTTP crawler, governing Gemini-model training and grounding in Gemini Apps/Vertex AI. It does **not** affect Google Search inclusion or Search ranking. Googlebot remains the crawler controlling AI Overviews/AI Mode Search eligibility. [115][36] |
| **Copilot/Bing** | **2026-05-19 [confirmed]:** public-web results come from Bing Search, so normal Bing indexing and any applicable Bingbot controls govern discoverability; Microsoft has not announced a distinct public “Copilot citation crawler” in this window. [112] |

### `llms.txt`: adoption and effect

- **2026-06-15 [reported]:** Ahrefs examined 137,210 domains; approximately 38,360 had a valid `llms.txt`, but **97% of those files received zero requests** during May 2026 and retrieval bots represented only about 1.1% of requests that did occur. [199][191]

- **2026-06-20 [reported]:** HTTP Archive/CrUX-based measurement found adoption around **6.28% of the top 1,000**, **5.61% of the top 10,000** and **5.07% of the top million**, showing concentration among technically sophisticated sites rather than universal adoption. [199]

- **2026-09-07 [reported]:** SE Ranking’s roughly 300,000-domain analysis found **10.13% adoption** and no measurable relationship between publishing `llms.txt` and AI-citation frequency; its statistical and machine-learning tests both returned a null signal. [193][201]

- **2026-10-02 [confirmed]:** Google explicitly says no AI text file or special machine-readable markup is required for AI Overviews or AI Mode. **As of 2026-10-22 [reported]:** OpenAI, Anthropic and Perplexity crawler-control documentation likewise does not identify `llms.txt` as a citation-ranking signal. [36][191]

- **Recommendation dated 2026-10-22 [reported]:** publish `llms.txt` only as a low-cost documentation index for humans and experimental agents; do not divert work from HTML accessibility, sitemaps, internal links, bot/WAF access or content quality. Evidence of citation lift remains thin and predominantly null.

---

## 3. Case studies with numbers: tactics and measured outcomes

These are mostly vendor-authored observational cases; they demonstrate possibilities, **not isolated causal effects**.

| Tactic | Date and source | Intervention | Metric / result | Evidence assessment |
|---|---|---|---|---|
| **Structured data** | **2026-05-11, Ahrefs matched-page analysis** **[reported]** | 1,885 pages adding JSON-LD compared with 4,000 controls | AI Mode **+2.4%** and ChatGPT **+2.2%**, neither significant; AI Overview citations **−4.6%**, small but statistically significant | Best available controlled evidence says generic schema is not a direct GEO lever. [249][252] |
| **Structured data plus broader optimization** | **2026-04-04, Helpful Hero / Lacrosse Marketing** **[reported]** | Schema improved across ten pages alongside website-grade fixes | Vendor “AI Visibility Score” rose **55%**; site grade 60→93; first tracked AI referral and a ChatGPT citation | Weak attribution and proprietary score; useful only as a hypothesis. [238] |
| **Original research and digital PR** | **2026-05-23, ProjectFlow case study** **[reported]** | Two original studies, including a 500-person survey, plus 20+ external publications, schema and content changes | Weekly 50-query mention/citation rate rose **12%→87% in four months** | Strong numeric outcome but bundled tactics and anonymized client make causality uncertain. [254] |
| **Comparison pages — developer tool** | **2026-10-12, DataDab Series-B devtools case** **[reported]** | Four head-to-head and three “best X for Y” pages | Comparison-stage organic traffic increased **4.3× in six months**; brand appeared for 6/10 top-of-funnel prompts | Highly relevant vertical; vendor case with no independent analytics audit. [224] |
| **Comparison pages — B2B SaaS** | **2026-01-27, Discovered Labs; result still tracked in window** **[reported]** | Six competitor comparison pages | All six reached organic top three within 90 days; four of six were cited by ChatGPT or Perplexity | Clear page-level result, but pre-window publication and bundled content framework. [228] |
| **Reddit/community activity** | **2026-06-19, OtterlyAI** **[reported]** | 60-day comparison of two communities posting identical content; one generated replies and one remained dormant | Active community received **9× more AI citations**, ranked for **4× more Google keywords** and covered **18× more search volume** | Interesting quasi-experiment; small community pair and vendor-owned tracking. [299] |
| **Reddit platform risk** | **2026-08-14–2026-08-17, Promptwatch** **[reported]** | Platform/model-routing change rather than publisher tactic | Reddit’s visible ChatGPT citation share fell **3.83%→0.52%**, an 86.4% relative decline | Shows why community strategy should not depend on one engine’s citation display. [311] |
| **Programmatic SEO — positive** | **2026-10-07, Huptech five-client case** **[reported]** | Approximately 830 templated pages over 16 months | **135,000 clicks** and **3.54 million impressions** | Aggregate result; page quality and client distribution are not independently verified. [268] |
| **Programmatic SEO — pruning** | **2026-07-21, Nico Digital controlled build** **[reported]** | 162 pages across three templates, then pruning at day 120 | Eleven pages produced about **75% of clicks**; removing most pages increased total program traffic **29%** | Actionable evidence that page count is a poor success metric. [271] |
| **Programmatic SEO — developer/document transformation** | **2026-10-03, SEO Savages/Prawomat** **[reported]** | 1,125 letter pages, then rebuilding pages that earned demand so AI answers could quote them | Rebuild produced **2.9× Google clicks** and **6.4× AI-answer appearances in 19 days** | Promising but vendor case and short measurement window. [278] |
| **Content refresh** | **2026-Q1, Position Digital / Resource Guru** **[reported]** | Refreshed pages for 44 keywords with new copy, UX, expert input and FAQ schema | Share of voice increased **1.82%→9.84%**, or **440.66%**, from January to March | Multiple simultaneous changes; still a useful refresh benchmark. [285] |
| **Content refresh benchmark** | **2026-06-04, Workshop Digital dataset** **[reported]** | 95 refreshed pages among 273 measured content events | Refreshed pages had **447.7% more organic sessions** in the 90 days after refresh than the 90 days before | Before/after analysis lacks untreated controls and may contain selection bias. [292] |

**2026-10-22 conclusion:** original, attributable data; candid comparison pages; active expert communities; and selective refresh/pruning have better evidence than generic schema or `llms.txt`. Programmatic publishing works when each page contains unique data or executable utility, not when scale itself is the product.

---

## 4. Technical SEO: Core Web Vitals, rendering/JS, indexing, schema and docs sites

### Core Web Vitals

- **2026-10-13 [confirmed]:** Chrome/CrUX began exposing **experimental soft-navigation metrics** for SPAs. The experimental INP variant segments responsiveness by client-side route rather than attributing the entire session to the original hard navigation; graduation is targeted for May 2027, so it is not yet a production ranking change. [329][331]

- **2026-10-22 [confirmed]:** production “good” thresholds remain **LCP ≤2.5 seconds, INP ≤200 ms and CLS ≤0.1 at the 75th percentile**. Reports of a 2.0-second LCP threshold in 2026 are contradicted by current Google/web.dev guidance and should not be used for planning. [337][339]

### Rendering, JavaScript and indexing

- **2026-10-02 [confirmed]:** Google processes JavaScript applications through crawling, rendering and indexing; pages returning 200 are queued for headless-Chromium rendering unless a robots directive prevents indexing. Google then parses rendered HTML for content and links. [322]

- **2026-10-02 [confirmed]:** Google continues to recommend server-side rendering, static rendering or hydration; dynamic rendering is a workaround, not a long-term solution. This matters because many AI search crawlers do not promise full client-side JavaScript execution. [324]

- **2026-03-31 guidance still current on 2026-10-22 [confirmed]:** Google processes only the first **2 MB** of an HTML response; bytes after the cutoff are neither rendered nor indexed. Its rendering service executes JS/CSS and XHR but does not request images or videos while constructing textual state. Large documentation payloads should therefore not embed critical reference material after oversized inline scripts or serialized state. [313]

- **2026-10-03 [reported from Search Central Live]:** Google described typical new-URL discovery near 20 hours, known-URL refresh around 30 days, rendering execution in seconds but queues potentially lasting hours, and much slower outliers. Googlebot uses a tall viewport but does not click or scroll, so docs content triggered only by interaction or scroll may remain unseen. [316]

- **2026-10-06 [confirmed]:** Google documented `Retry-After` for emergency crawl-rate reduction. Docs platforms experiencing build incidents should return accurate 429/503 responses and `Retry-After`, rather than blanket-blocking Googlebot or AI search bots. [323]

### Structured data and Schema.org

- **2026-09-16 [confirmed]:** Schema.org released version **30.1**. Vocabulary availability does not mean Google or an answer engine uses every type as a search feature. [344][356]

- **2026-05-07–2026-08 [confirmed]:** Google retired FAQ rich results on May 7, removed the corresponding Search Console/Rich Results Test reporting in June, and removed Search Console API support in August. `FAQPage` remains valid Schema.org vocabulary, but it no longer earns the Google FAQ SERP treatment. [343][346]

- **2026-10-02 [confirmed]:** Google says AI Overviews and AI Mode require neither special schema nor AI-specific markup. Structured data should be retained where it accurately mirrors visible content—such as Organization, SoftwareApplication/Product, Breadcrumb, Article and Dataset—but not sold internally as a direct citation switch. [36]

### Specific guidance for documentation and developer content

- **2026-10-22 recommendation:** server-render versioned docs, API reference, error messages, examples, prerequisites, limits and pricing into crawlable HTML; expose stable canonical URLs; and link every reference page from navigable hubs and XML sitemaps.

- **2026-10-22 recommendation:** give deprecated versions explicit status banners and successor links; avoid canonicalizing materially different versions to “latest,” because models must be able to cite the version matching the prompt.

- **2026-10-22 recommendation:** place one self-contained answer near the start of each section, followed by a tested code sample, expected output, edge cases and last-tested date. This follows the 2026 passage evidence without mistaking formatting alone for a ranking factor. [408][420]

- **2026-10-22 recommendation:** make copy buttons, tabbed language examples and interactive API explorers progressive enhancements. Ensure default HTML contains the primary code and explanatory text, because Googlebot and answer-engine crawlers may not click tabs.

---

## 5. What has stopped working or now carries risk

- **2026-10-01 [confirmed]:** “publish raw AI output at scale” is not defensible quality control. Google now calls manual fact-checking of AI-generated body copy, titles, descriptions, structured data and image alt text **critical**. AI use itself is not banned. [435][439]

- **2026-08-28 [confirmed]:** scaled content abuse covers large volumes of low-value or unoriginal pages regardless of whether they are produced by AI, scraping, translation, synonymization or manual labor. Consequences can include lower rankings, feature removal, manual action or exclusion from Search. [435]

- **2026-08-31 [reported]:** mass programmatic expansion paired with generic AI copy carries section- or site-wide risk: one 1.5-million-URL YMYL property lost visibility for over 200,000 queries during the August spam update. This is a case observation, not proof that every large site will be penalized. [452]

- **2026-10-22 [confirmed]:** generating a separate page for every conceivable fan-out query primarily to manipulate Search or AI responses violates Google’s scaled-content policy. Build pages only where there is distinct user value, data or functionality. [446]

- **2026-05-07 [confirmed]:** FAQ schema as a rich-result tactic has stopped working; retain it only when semantically useful, not for promised SERP expansion. [346]

- **2026-10-22 [reported]:** generic JSON-LD, `llms.txt`, “AI-readable Markdown mirrors,” answer-first formatting and cosmetic timestamp changes are not independently proven citation boosters. The controlled schema result was null or negative, 97% of observed `llms.txt` files were unread, and controlled LLM testing found formatting-only effects small. [252][193][420]

- **2026-08-30 [confirmed]:** parasite/site-reputation tactics remain risky. Outside the EEA, offending sections can receive manual actions; inside the EEA, Google can detach a section from the host domain’s reputation and rank it independently. Original, integrated, editorially supervised third-party content is not automatically abusive. [20]

- **2026-10-22 [reported]:** Reddit seeding, fake reviews and astroturfed community posts are especially brittle: engagement may improve discovery, but ChatGPT’s visible Reddit citation share changed by more than 80% within days in August. [300]

- **2026-10-22 [confirmed]:** blocking the wrong bot has become a common self-inflicted problem: blocking GPTBot does not block ChatGPT Search, blocking Google-Extended does not remove Google Search visibility, and allowing a user-agent while rejecting its verified IPs at the WAF can still make the site inaccessible. [90][115][120]

---

## 6. Practical checklist for a developer-tool company this month

| Priority | October 2026 action | Completion test |
|---|---|---|
| **P0** | **2026-10-22 [confirmed]:** allow Googlebot, Bingbot, `OAI-SearchBot` and `PerplexityBot` through `robots.txt`, CDN and WAF if citation visibility is desired; validate against vendors’ live IP JSON rather than user-agent alone. Decide separately whether to allow `GPTBot`, `ClaudeBot` and `Google-Extended` for training/grounding. [90][120][115] | Each bot receives 200 HTML on five representative docs, pricing and comparison URLs; server logs show no 403/challenge loops. |
| **P0** | **2026-10-22 [confirmed]:** verify that every target page is indexed, snippet-eligible, canonical and internally linked. Google requires normal Search eligibility for AI Overviews/AI Mode. [36] | URL Inspection passes; canonical agrees across HTML, sitemap and redirects; no accidental `nosnippet`, `noindex` or `data-nosnippet`. |
| **P0** | **2026-10-22 [confirmed]:** manually review all AI-assisted copy and metadata for technical correctness, package/version names, commands, outputs, pricing and security implications. [435] | Named engineer/editor and “last tested” date recorded in the CMS or repository. |
| **P0** | **2026-10-22 [reported]:** prune or merge programmatic pages that lack unique data, demand or utility before creating more. [271][452] | Export pages with zero impressions/citations/conversions; assign keep, improve, merge or remove; check that removal improves rather than fragments topical coverage. |
| **P1** | **2026-10-22 [reported]:** create or update honest comparison pages for the three competitors most frequently appearing in customer calls and AI answers. Include explicit pricing where public, deployment model, supported languages/frameworks, limits, migration steps and dated test methodology. [420][224] | Each claim links to a primary source or reproducible test; no fabricated review ratings or one-sided tables. |
| **P1** | **2026-10-22 [reported]:** publish one first-party benchmark using product telemetry, an open-source corpus or a disclosed survey; release methodology and downloadable data where safe. | Page states sample, dates, exclusions and limitations; Dataset schema mirrors the visible methodology; outreach targets relevant maintainers and publications. |
| **P1** | **2026-10-22 [reported]:** rewrite the top 20 docs and commercial pages into self-contained answer passages followed by executable examples and edge cases. [408] | A reader can understand each principal answer from one paragraph; every code example passes CI against the stated version. |
| **P1** | **2026-10-22 [reported]:** refresh pages losing impressions or citations, prioritizing pages with commercial relevance and existing rank positions 4–20. Do not change dates without material revision. [285][287] | Change log records old/new content, validation date and 28-/56-day GSC and citation outcomes. |
| **P1** | **2026-10-22 [confirmed]:** configure Search Console’s generative-AI and multimodal reports, platform properties where relevant, Bing Webmaster Tools and analytics segments for `utm_source=chatgpt.com`, Perplexity, Claude and Copilot referrals. [44][369][101] | Weekly dashboard separates citations/mentions, AI impressions, attributable sessions, assisted trials and revenue; it does not equate a mention with a click. |
| **P1** | **2026-10-22 [reported]:** establish a repeated prompt panel—at least five runs per prompt—covering category, problem, integration, migration, pricing and competitor questions across ChatGPT, Perplexity, Gemini, Claude, Copilot and Google AI. [393] | Store prompt, locale, model/surface, date, answer, cited URL, brand mention and sentiment; report confidence intervals rather than one-off screenshots. |
| **P2** | **2026-10-22 [reported]:** participate transparently in the developer communities where maintainers and users already discuss the problem; answer questions and disclose affiliation instead of manufacturing Reddit threads. [299][300] | Track accepted answers, substantive replies, branded search and cited discussions—not post volume. |
| **P2** | **2026-10-22 [confirmed]:** test SPA soft-navigation performance while still targeting production CWV thresholds of LCP 2.5 s, INP 200 ms and CLS 0.1 at p75. [329][337] | CrUX/PageSpeed field data passes by template; experimental soft-navigation telemetry is collected separately from production CWV reporting. |
| **P2** | **2026-10-22 [reported]:** optionally publish a concise `llms.txt` generated from the canonical docs navigation, but cap effort at a few engineering hours and do not treat it as a ranking project. [193] | File returns 200, lists only canonical pages and is monitored in logs; success is actual verified requests, not file existence. |

**Bottom line dated 2026-10-22:** the defensible strategy is conventional technical SEO plus uniquely useful, current and verifiable developer information. Retrieval eligibility, topical relevance, first-party evidence, candid commercial facts and third-party corroboration have meaningful support; special GEO files, cosmetic schema and scaled AI copy do not.

## Sources

1. [Latest Google Search Documentation Updates | Google Search ...](https://developers.google.com/search/updates/)
2. [History for Ranking | Google Search Status Dashboard](https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history)
3. [Google Search Ranking Volatility & Chatter Heat Up October 20 & 21](https://www.seroundtable.com/google-search-ranking-volatility-42347.html) (2026-10-21)
4. [Google Search Ranking Volatility & Chatter Spike Today](https://www.seroundtable.com/google-search-ranking-volatility-chatter-42317.html) (2026-10-16)
5. [Google Search Console and Googlebot Changes 2026](https://keywordseverywhere.com/news/google-algorithm-updates/search-console-changes/) (2026-10-02)
6. [Mise à jour des règles concernant le spam lié à la ...](https://developers.google.com/search/blog/2026/08/update-site-reputation-policy?hl=fr&authuser=00)
7. [Google Ends Spam Update, Shares Crawl Timing Ranges – SEO Pulse](https://www.searchenginejournal.com/seo-pulse-google-spam-update-crawl-timing-ranges/592469/) (2026-10-10)
8. [Aktualizacja zasad dotyczących reputacji witryny](https://developers.google.com/search/blog/2026/08/update-site-reputation-policy?hl=pl)
9. [Rank Tracker Data, ChatGPT Tags & AI Search Links – SEO Pulse](https://www.searchenginejournal.com/seo-pulse-rank-tracker-data-chatgpt-tags-ai-search-links/593171/) (2026-10-17)
10. [feed.atom](https://status.search.google.com/en/feed.atom)
11. [October 2026 Google Webmaster Report](https://www.seroundtable.com/october-2026-google-webmaster-report-42185.html) (2026-10-01)
12. [AI Overviews tripled on brand searches in September](https://www.marketscale.com/industries/marketing-tech/googles-ai-overviews-roughly-tripled-on-brand-name-searches-in-september) (2026-10-16)
13. [Google Search Central (@googlesearchc) on X](https://x.com/googlesearchc/status/2103159043347128638) (2026-09-24)
14. [Neueste Änderungen an der Dokumentation zur Google Suche | Google Search Central | What's new | Google for Developers](https://developers.google.com/search/updates?authuser=0&hl=de&visit_id=639158536122412204-4047472511&rd=1)
15. [Dernières mises à jour de la documentation sur la recherche Google | Google Search Central | What's new | Google for Developers](https://developers.google.com/search/updates?authuser=4&hl=fr&visit_id=639129992510616220-2197025092&rd=1)
16. [More ways to connect with the web from Search](https://blog.google/products-and-platforms/products/search/updates-ai-mode-overviews-explore-web/) (2026-10-15)
17. [Q2 2026 earnings call: Remarks from our CEO](https://blog.google/company-news/inside-google/message-ceo/alphabet-earnings-q2-2026/) (2026-07-22)
18. [News from Google](https://blog.google/rss/)
19. [News from Google](https://blog.google/intl/ms-my/rss/)
20. [A new era for AI Search](https://blog.google/products-and-platforms/products/search/search-io-2026/) (2026-05-19)
21. [AI - The Keyword](https://blog.google/innovation-and-ai/technology/ai/rss/)
22. [AI Features and Your Website | Google Search Central](https://developers.google.com/search/docs/appearance/ai-features)
23. [Gemini 4 Argon: Built to solve your hardest problems](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-argon/?authuser=30&hl=fa) (2026-10-13)
24. [Gemini 4 Argon: Built to solve your hardest problems](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-argon/?authuser=377174373&hl=he) (2026-10-13)
25. [Google's Guide to Optimizing for Generative AI Features on Google Search | Google Search Central | Documentation | Google for Developers](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide/)
26. [Gemini 4 Argon: Built to solve your hardest problems](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-argon/?authuser=431&hl=tr) (2026-10-13)
27. [Building AI to accelerate science and improve lives](https://blog.google/innovation-and-ai/technology/ai/ai-applications-science-people/) (2026-09-15)
28. [New opportunities, control and insights for website owners](https://blog.google/products-and-platforms/products/search/new-controls-website-owners/) (2026-06-03)
29. [100 things we announced at I/O 2026](https://blog.google/innovation-and-ai/technology/ai/google-io-2026-all-our-announcements/) (2026-05-20)
30. [Introducing Search Generative AI performance reports in Search ...](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports) (2026-06-03)
31. [Google Developers](https://developers.google.com/search/blog/feed.xml)
32. [Search and SEO Blog | Google Search Central Blog](https://developers.google.com/search/blog)
33. [Nowość w Search Console – raporty skuteczności dotyczące generatywnej AI w wyszukiwarce | Google Search Central Blog | Google for Developers](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports?hl=pl)
34. [What's new on Google Search Central](https://developers.google.com/search/news)
35. [ประกาศการรายงานประสิทธิภาพการค้นหาแบบหลายโมดัลบนเว็บ ...](https://developers.google.com/search/blog/2026/09/web-multimodal-in-sc?hl=th)
36. [New learning paths: curated YouTube playlists for Search ...](https://developers.google.com/search/blog/2026/10/seo-learning-paths) (2026-10-06)
37. [Search Central Deep Dive Europe 2026: Apparently we're ...](https://developers.google.com/search/blog/2026/07/search-central-live-deep-dive-europe-2026) (2026-07-06)
38. [Search Central Live débarque à Bogota et à Mexico](https://developers.google.com/search/blog/2026/09/search-central-live-mexico-and-colombia?hl=fr)
39. [Gary Illyes | Google Search Central Blog](https://developers.google.com/search/blog/authors/gary-illyes) (2026-09-16)
40. [Search Central Live Inde 2026 : Bangalore, nous voilà ...](https://developers.google.com/search/blog/2026/09/search-central-live-india-2026?hl=fr)
41. [Pembaruan Dokumentasi Terkini untuk Google Penelusuran | Pusat Google Penelusuran | What's new | Google for Developers](https://developers.google.com/search/updates?authuser=002&hl=id&visit_id=639128068233742638-3596566420&rd=1)
42. [Lizzi Sassman | Google Search Central Blog](https://developers.google.com/search/blog/authors/lizzi-sassman) (2026-07-29)
43. [See how content from social and video platforms performs ...](https://developers.google.com/search/blog/2026/07/search-console-social-video-platforms) (2026-07-07)
44. [May 2026 Core Update: Visibility Analysis and Data Updates](https://www.sistrix.com/blog/may-2026-core-update-visibility-analysis-and-data-updates/) (2026-05-26)
45. [Mai 2026 Core Update: Vergleichscontent verliert, Marken ...](https://www.sistrix.de/news/mai-2026-core-update/) (2026-05-29)
46. [Who Does the May 2026 Core Update Reward or Punish?](https://www.isocialweb.agency/en/google-updates/) (2026-06-04)
47. [Winners & Losers: September 2026 Spam Update](https://techevangelistseo.com/spam-update-winners-losers)
48. [May 2026 Google Core Update: Winners, Losers & What to Do ...](https://violetboltmedia.com.au/may-2026-google-core-update/) (2026-06-04)
49. [Google algorithm updates: The May 2026 core update rewards creators and sinks aggregators](https://www.isocialweb.agency/en/blog/google-updates/) (2026-06-04)
50. [Archive - SISTRIX](https://www.sistrix.com/blog/archive/?selected=2026)
