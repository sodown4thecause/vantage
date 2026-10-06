# S60 — Switch Rescue manual test kit

**Track:** Go-to-market · **Wave:** 5 · **Size:** S · **Owner:** human-led, agent prepares · **Depends on:** none · **Window:** **1 to 14 Nov 2026** (Reddit RSS ends 13 Nov)

## Outcome
Everything needed to run Astra's two-week manual test on GummySearch, F5Bot and Reddit-RSS users, with pass/fail gates tracked.

## Gates (from the reports)
Three completed rescues, two activations, two founders paying. Stop and rethink if not met by 14 Nov.

## Agent scope (preparation only; the owner contacts people)
- `docs/gtm/switch-rescue.md`: target list method (public posts where people ask for GummySearch/F5Bot alternatives; **only people who publicly asked**), a one-page offer, intake form fields, the rescue procedure (collect their keyword list → S15 importer or manual pack → deliver first leads within 24 h), tracking sheet columns (who, source thread, date, rescued, activated, paying, founder time, cost), and a no-spam checklist (no mass DMs, no automation, follow each venue's rules, disclose affiliation).
- A CSV template and a small script `scripts/gtm/summarize.ts` computing gate status from the tracking CSV.
- Collect 5 to 10 real keyword exports (with permission) to refine S15 parsers.

## Acceptance criteria
- [ ] Kit committed; owner confirms it is usable.
- [ ] Gate summary script has tests.

## Human gate (H9)
All outreach is performed by the owner personally, from their own accounts, in their own words.
