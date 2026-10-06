# S30 — Community Rules table and public Rules Index

**Track:** Reply Briefs (Idea 3) · **Wave:** 2 · **Size:** M · **Owner:** agent + owner review · **Depends on:** none (S07 for the re-check job, optional) · **Unblocks:** S31, S61

## Outcome
A public page per community stating promotion, link and AI-text rules with a last-checked date, which also powers the venue-rules section of every Reply Brief.

## Scope
- **DB:** `community_rule(id, platform, community, display_name, allows_promotion text check in ('yes','limited','no','unknown'), allows_links text, bans_ai_text text, self_promo_notes, source_url, last_checked date, checked_by text, notes, unique(platform, community))` and `community_rule_change(id, rule_id, field, old, new, detected_at, status check in ('pending','accepted','rejected'))`.
- **Seed:** 100 top developer communities (data file `data/community-rules.json`), starting with those named in the review: Hacker News (bans generated or AI-edited comments; software kills comments classified as AI), r/SaaS (bans promoting opportunity-detection tools; **do not launch there**), r/selfhosted, r/opensource, r/devops, DEV.to, Lobsters. **Every row needs a primary-source link; mark `unknown` rather than guess.**
- **Pages:** `/rules` (searchable list), `/rules/[platform]/[community]` ("Can I mention my product in r/devops?" style headline, rules, last checked, source link, "Vantage will give you a brief only" badge where AI text is banned). Metadata, sitemap entries, `FAQPage` JSON-LD.
- **Re-check job (optional, same PR or follow-up):** weekly cron route fetches each rules page via `browserMarkdown` (S07; **not** for reddit.com, use the official rules JSON/pages that robots allow, or skip and keep manual), diffs, and writes `community_rule_change` rows as `pending` for owner review. Never auto-publish a rules change.
- **Lib:** `lib/rules/lookup.ts` `getRule(platform, community)` used by S31.

## Acceptance criteria
- [ ] 100 seeded rows with source URLs; owner spot-check recorded.
- [ ] Pages render from DB with a graceful empty state; Lighthouse SEO >= 95.
- [ ] Lookup tests incl. unknown community (returns conservative defaults: no draft, disclose).
- [ ] Change-detection test (diff produces pending row, no public change).

## Out of scope
Reply Brief (S31), contribution ledger (S32).
