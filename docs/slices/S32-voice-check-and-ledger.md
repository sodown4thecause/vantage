# S32 — Voice-check editor and contribution ledger

**Track:** Reply Briefs (Idea 3) · **Wave:** 4 · **Size:** M · **Owner:** agent · **Depends on:** S31 · **Unblocks:** S33

## Outcome
Users write their own reply in a plain editor that flags stock AI phrasing and repeated lines; Vantage tracks how helpful vs promotional their activity is per community.

## Scope
- **Voice check:** `lib/voice/check.ts` `checkVoice(text, history)`; flags phrases from a versioned list `lib/voice/phrases.ts` (e.g. "I hope this helps", "Great question", "delve", "In conclusion", em-dash density, triple-bullet lists), and any line with Jaccard/shingle similarity >= 0.8 to the last 10 stored comments. Returns `{flags:[{start,end,kind,why}], score}`. **No rewrite button, no suggested replacement text.**
- **DB:** `contribution_entry(id, workspace_id, platform, community, url, kind check in ('helpful','promotional','neutral'), text_hash, shingle_hashes jsonb, created_at)`. `text_hash` is a hash of the normalized whole comment (exact-duplicate check). `shingle_hashes` is an array with one entry per non-empty line: the sorted set of keyed 64-bit hashes (HMAC with a server secret, e.g. `VOICE_HASH_KEY`, so stored shingles cannot be enumerated against likely word triples) of that line's normalized word 3-shingles (lower-cased, punctuation stripped). `checkVoice` computes the same set for each line of the new text and takes the Jaccard similarity against each stored line's set, so the >= 0.8 check works without keeping the text (store the full text only if the user opts in). Keep the 10 most recent entries per workspace and at most 200 hashes per line.
- **UI:** `app/opportunities/[id]/editor.tsx` plain textarea, live flags, "I posted this" form (URL + kind), community panel showing helpful:promotional ratio with a warning above a threshold (default 1 promotional per 9 helpful, configurable).
- Hooks into S31 (`reply_brief` marked used) and outcomes (`opportunity_outcome` event `acted_on`, existing `lib/outcomes/repository.ts`).

## Acceptance criteria
- [ ] Unit tests for each flag kind and for the similarity check (near-duplicate, paraphrase below threshold).
- [ ] No text leaves the browser unless the user clicks "I posted this" with opt-in.
- [ ] Ratio warning tests.
