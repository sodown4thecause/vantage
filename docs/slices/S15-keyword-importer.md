# S15 — Keyword importer (GummySearch / F5Bot / Syften)

**Track:** Reddit/Acquisition (Idea 1, Astra's Switch Rescue) · **Wave:** 3 · **Size:** M · **Owner:** agent · **Depends on:** S20 · **Unblocks:** S60 usefulness

## Outcome
A switcher pastes or uploads their old keyword list and gets a Monitor Pack in under a minute.

## Scope
- `lib/import/keywords.ts` parsers: GummySearch export (CSV with keyword/audience columns; confirm columns from real exports collected in S60), F5Bot (plain list / email-alert keywords, supports `-negative` and quoted phrases), Syften (query syntax with `site:`/`-` operators, translate to pack queries and negative keywords), generic one-per-line.
- Output the S20 `MonitorPack` shape: `queries[]`, `negativeKeywords[]`, `communities[]` (subreddits parsed from `r/` mentions), warnings for syntax that cannot be translated (list them, never drop silently).
- UI `app/import/page.tsx`: textarea + file upload (max 256 KB, text only), preview of the resulting pack, "Save as my Monitor Pack" (needs account; if anonymous, hold in `localStorage` and redirect to sign-up, S23).
- Public landing section on `/gummysearch-alternative` and `/f5bot-alternative` (S16) linking to the importer.

## Acceptance criteria
- [ ] Parser tests with representative fixtures for each tool, including malformed lines, unicode, 5,000-keyword input (performance < 200 ms), and over-limit input rejected with a clear message.
- [ ] Limits from S05 applied on save (Free: 5 keywords) with a visible "x more keywords on Pro" notice.
- [ ] No keyword content logged.

## Out of scope
Fetching a user's account data from those tools (no credentials accepted).
