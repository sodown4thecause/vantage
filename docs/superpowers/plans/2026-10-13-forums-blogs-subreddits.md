# Plan: dev forums, blogs and subreddits from a monitoring profile

## Problem (evidence)

Staging (Neon branch `staging`, 13 Oct 2026) has one monitoring profile. Saving it
provisioned exactly one source, `Profile: Hacker News`, and the workspace holds four
HN documents. Nothing in the profile flow reaches Reddit, developer forums or blogs:

- `provisionProfileSources` only writes an HN source.
- The community catalog is fixed AI/LLM feeds, not the customer's keywords.
- "Search a community" covers HN, Reddit, Stack Overflow and GitHub — no forums or blogs.
- "Scan now" and the cron only run free-lane sources, so a keyed Reddit source never
  runs unless the owner presses "Scan this source".

## Change

1. **Web discussions collector** (`lib/collectors/web-discussions.ts`) on the existing
   `web_search` type, selected by `config.provider = "tinyfish-web"` (Alexandria keeps
   its own providers). For each topic (max 3) and each kind:
   - `forum`: TinyFish Search restricted to a curated list of public developer forums
     (DEV, Indie Hackers, Lobsters, public Discourse instances…).
   - `blog`: TinyFish Search excluding social, video, forum and the workspace's own
     product domain.
   - Bounded by `after_date` (first scan 7 days, then the saved cursor), `maxResults`
     (default 10, max 20, shared between forums and blogs) and a TinyFish Fetch of the
     hits for page text (best effort).
   - Second page reader: Cloudflare Browser Run (`lib/browser/run.ts`, the existing
     guarded `BROWSER` binding) renders up to 5 pages TinyFish Fetch could not read.
   - Fallback: Firecrawl `/v2/search` (`tbs=qdr:w`) through `runPaidCall`, used only
     when TinyFish is unavailable and paid providers are enabled.
   - Documents use new TS-only platforms `forum` and `blog` (text column; no migration).
2. **Profile provisioning** adds `Profile: Reddit` (TinyFish Reddit lane, `queries`
   from topics) and `Profile: Dev forums & blogs` (lane `byok`), within the plan's
   source cap. HN stays first and unchanged.
3. **Reddit collector** accepts `queries` (max 3) as well as `query`.
4. **Manual "Scan now"** also runs keyed (`byok`) Reddit and web-discussion sources.
   Cron stays free-only (cost decision left to the owner).
5. **Search a community** gains "Dev forums" and "Blogs".
6. Production gate in `runCollector` admits `web_search` + `byok` + `tinyfish-web`.

## Verification

- Vitest: collector (forum/blog classification, own-domain exclusion, dedupe, recency,
  Firecrawl fallback + paid gate, abort), provisioning, search builder, scan selection.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- Live smoke: `test/live-communities.smoke.test.ts` (skipped unless `LIVE_SMOKE=1`) runs
  the forum/blog and Reddit collectors for the contextfor.dev profile against real
  TinyFish/Firecrawl. Requires egress to `api.search.tinyfish.ai`,
  `api.fetch.tinyfish.ai`, `api.firecrawl.dev`.

## Not in this change

- crawl4ai, webclaw, Scrapy and Crawlee need a Python/Rust/long-lived Node process and
  cannot run in a Worker isolate. They would run in a Cloudflare Container behind a
  service binding; Browser Run covers rendering inside the Worker today.
- LLM relevance triage (Workers AI or Vercel AI Gateway) on collected documents.
  Workers AI embeddings already exist behind `VANTAGE_SEMANTIC_MODE` (production: off).
