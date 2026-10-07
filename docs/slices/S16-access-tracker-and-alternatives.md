# S16 — Platform Access Tracker and "alternative" pages

**Track:** Website (Idea 1) · **Wave:** 4 · **Size:** M · **Owner:** agent (+ owner review of facts) · **Depends on:** S11 · **Unblocks:** S61 · **Deadline:** live by **13 Nov 2026**

## Outcome
A public, dated page listing each source, how Vantage reads it, what it costs, and a log of rule changes, plus pages timed to competitor deadlines.

## Scope
- **DB:** `platform_status(source_key primary key, how_read text, cost_note text, state text, updated_at)` (state mirrors `source_switch` live) and `access_log(id, source_key, event_date date, title, detail, source_url, kind)`; seed from the review: Reddit (31 Oct new API requests stop; 13 Nov RSS off; 12 Jan unregistered apps lose access; March 2027 public API closes), X (pay-per-use pricing from 21 Sep 2026), HN (AI-written comments banned), r/SaaS rule (June 2026), Product Hunt (written permission for commercial use). **Each entry needs a primary-source URL; owner verifies before publish.**
- **Pages (server components, no client JS needed):** `/access-tracker`, `/gummysearch-alternative`, `/f5bot-alternative`, `/reddit-rss-ending` ("what still works"). Price in the headline of the alternatives (Free, Pro $5). Link to importer (S15) and Radar (S22).
- SEO: titles/meta, canonical URLs, `sitemap.ts`, `robots.ts`, JSON-LD (`WebPage`, `FAQPage` where real Q&A exists). Use the `anthropic-skills:seo-aeo-geo` guidance for AEO structure.
- Live state badge reads `source_switch` (S04) and last sweep result (S11).
- Content rule: facts stated as "I didn't find", never "nobody does"; show a "last checked" date; competitor facts must carry a source link and a note to re-check before quoting.

## Acceptance criteria
- [ ] Pages render without a database for static parts and degrade gracefully without it for live badges.
- [ ] Lighthouse SEO >= 95 on all four pages (record score in PR).
- [ ] Every dated claim has a source URL and a checked-on date; owner sign-off recorded in PR.
- [ ] Sitemap includes the pages; `noindex` is not set.

## Out of scope
Rules Index (S30), pricing page (S43).
