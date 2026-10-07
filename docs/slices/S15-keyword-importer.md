# S15 — Keyword importer (GummySearch / F5Bot / Syften)

**Track:** Reddit/Acquisition (Idea 1, Astra's Switch Rescue) · **Wave:** 3 · **Size:** M · **Owner:** agent · **Depends on:** S20 · **Unblocks:** S60 usefulness

## Outcome
A switcher pastes or uploads their old keyword list and gets a Monitor Pack in under a minute.

## Scope
- `lib/import/keywords.ts` parsers: GummySearch export (CSV with keyword/audience columns; confirm columns from real exports collected in S60), F5Bot (plain list / email-alert keywords, supports `-negative` and quoted phrases), Syften (query syntax with `site:`/`-` operators, translate to pack queries and negative keywords), generic one-per-line.
- Output an importer draft for S20 (a partial `PackSpec`, not a valid one): `queries[]`, `negativeKeywords[]`, `communities: {platform: "reddit", name}[]` (subreddits parsed from `r/` mentions), and warnings for syntax that cannot be translated (list them, never drop silently). Before save, the UI merges it into a complete `PackSpec` (`product` asked on the preview step with name and one-line summary, `competitors: []`, `sources` defaulting to `["reddit"]` plus the platforms of any parsed communities) and runs the S20 validator in `lib/packs/validate.ts`; an invalid result is shown as errors, never saved.
- UI `app/import/page.tsx`: textarea + file upload (max 256 KB, text only), preview of the resulting pack, "Save as my Monitor Pack" (needs account; if anonymous, hold the pending pack in `localStorage` (try/catch, fall back to an in-memory notice), redirect to sign-up with `returnTo=/import`, and on return to `/import` reload the pending pack, re-validate and save it, then clear the stored copy). S23 restores only a Radar scan, so this return flow is owned by S15.
- Public landing section on `/gummysearch-alternative` and `/f5bot-alternative` (S16) linking to the importer.

## Acceptance criteria
- [ ] Parser tests with representative fixtures for each tool, including malformed lines, unicode, 5,000-keyword input (performance < 200 ms), and over-limit input rejected with a clear message.
- [ ] Limits: saving a pack is bounded only by the S20 pack limits (25 queries, 25 negative keywords, 20 communities). The S05 `keywords` limit (Free 5, Pro 25) caps the **queries applied to the workspace profile** (`applyPackToWorkspace`, which maps `queries[]` to profile `topics`): the apply step lets the user pick up to the plan limit and shows a visible "x more keywords on Pro" notice for the rest; the unapplied queries stay in the saved pack.
- [ ] Anonymous round trip: import, sign up, return to `/import` and the pending pack is restored and saved.
- [ ] No keyword content logged.

## Out of scope
Fetching a user's account data from those tools (no credentials accepted).
