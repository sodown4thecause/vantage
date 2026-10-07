# S31 — Reply Briefs (replace drafts)

**Track:** Reply Briefs (Idea 3) · **Wave:** 3 · **Size:** L · **Owner:** agent · **Depends on:** S20, S30 · **Unblocks:** S32, S33, S50

## Outcome
For every opportunity Vantage gives a brief, not a comment: the ask in one line, what they have tried, 2 to 3 facts from the user's own docs with links, one honest limitation, the venue's rules, the angle, a "don't" list and a disclosure line. Venues that ban AI text get the brief only.

## Scope
- **DB:** `reply_brief(id, workspace_id, opportunity_id, version, ask, tried jsonb, facts jsonb[{text,url,docRef}], honest_limit, venue jsonb, angle, donts jsonb, disclosure, created_at)`; keep `opportunity_draft` rows readable but stop creating them.
- **Lib:** `lib/briefs/generate.ts` `generateReplyBrief(input)`: pure, deterministic assembly from the opportunity evidence, the monitoring profile + docs retrieval (reuse the claim-support logic in `lib/drafting/generate.ts`: `flagUnsupportedClaims`, citations), and `getRule()` (S30). An optional LLM step may phrase "ask" and "angle" but **must not output a ready-to-post comment**; test with an assertion that no brief field exceeds 280 chars of contiguous second-person prose resembling a reply (heuristic documented in the test).
- **Honest limits:** `monitoring_profile` gets an optional `known_limitations jsonb` (migration) the user fills in onboarding/settings; brief shows one (never invents).
- **Repository:** `lib/briefs/repository.ts` (create, latest, list, mark `used`).
- **UI:** replace the draft panel in `app/opportunities/[id]/draft-panel.tsx` with `brief-panel.tsx`; for banned venues show the full brief with a "No draft: this venue bans AI text" label (there is never a draft section for them). Copy button copies the brief, not prose.
- **API:** `app/api/briefs/route.ts` (authorized).
- **Plan gate:** Pro only (S05 key `reply_briefs`); Free sees an upgrade teaser with a sample brief labelled "example".
- Migrate the feature flag: `VANTAGE_BRIEFS_ENABLED` (default true on staging).

## Acceptance criteria
- [ ] Brief for an HN thread contains no draft section; for a permissive venue contains every required brief field (ask, tried, facts, honest limit, venue rules, angle, don'ts, disclosure) and still no prose reply.
- [ ] Every fact has a link to the user's docs or is dropped; unsupported claims flagged.
- [ ] Old draft routes return 410 with a pointer (or are removed) and tests updated.
- [ ] Opportunity detail page e2e on staging shows a brief.

## Out of scope
Voice-check editor (S32), the brand guard test (S33).
