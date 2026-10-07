# S22 — Radar hero, results, share page, OG image, badge

**Track:** Radar (Idea 2) · **Wave:** 4 · **Size:** M · **Owner:** agent · **Depends on:** S21 · **Unblocks:** S61

## Outcome
The homepage hero is the input box; every result has a shareable, indexable page with an OG image and an optional README badge.

## Scope
- `app/page.tsx`: hero "Paste your repo. See who's asking for it right now." with input, Turnstile widget (S06; the form sends the widget response as the `x-turnstile-token` header on `POST /api/radar`, the header `lib/public/guard.ts` reads, otherwise production returns `turnstile_required`), "Or run it in your agent: `npx vantage init`" line (command is final only after S51), "Works with" strip.
- Client component `app/radar/radar-form.tsx` polling `GET /api/radar/[id]` (exponential backoff, 2 min cap), progress by source ("HN done, GitHub done, Reddit sweep cached").
- Results card list: intent badge (L1..L4), highlighted evidence sentence, "why it matched", reply-window clock, link out. No author data.
- `app/radar/[owner]/[repo]/page.tsx` (server-rendered from stored scan; `generateMetadata`; `noindex` unless `radar_scan.indexable` is true); "Keep watching every 3 hours" CTA (S23).
- OG image: render an HTML card with `browserScreenshot` (S07) once per scan, store in R2 (`ASSETS_BUCKET`), serve `/radar/[owner]/[repo]/og.png` with long cache; fallback to a static image.
- **Indexable flag:** add `radar_scan.indexable boolean not null default false` (migration, additive). The workflow's persist step (S21 step 6) sets it true only when the scan is `done`, has at least 3 threads with `intent_level >= DEFAULT_LEAD_THRESHOLD` (`lib/pipeline/intent-ladder.ts`), and no source in `source_status` is `error`; otherwise it stays false and the page is `noindex`. Thin or failed scans must never be indexable.
- Badge: `app/badge/[owner]/[repo]/route.ts` returning an SVG ("N matching threads in the latest scan"; S21 stores at most five threads and no author identity, so the badge counts the latest non-expired scan's stored threads, not distinct people, and says "no recent scan" if none) with 1 h cache and a link target to the radar page.
- Mock text on any marketing example must be labelled "example content".

## Acceptance criteria
- [ ] Playwright (Chromium is installed in this environment; do not run `playwright install`) smoke test on staging: submit repo, see results, open share page, fetch badge.
- [ ] Lighthouse performance >= 90 and accessibility >= 95 on `/` and a share page (record in PR).
- [ ] Share page shows only stored public data and a "scanned on <date>" stamp.
- [ ] OG image generated for a real scan and visible in a link preview tester.

## Out of scope
Account creation (S23), marketing copy beyond the hero (S61).
