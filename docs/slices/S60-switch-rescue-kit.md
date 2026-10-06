# S60 — Switch Rescue manual test kit

**Track:** Go-to-market · **Wave:** 5 · **Size:** S · **Owner:** human-led, agent prepares · **Depends on:** none to prepare; **the "paying" gate needs S40 (Stripe) or a manual payment link**, and any "open-source" or source-coverage claim needs the repo licensed/public and the sources live · **Window:** **1 to 14 Nov 2026** (Reddit RSS ends 13 Nov)

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

## Learned
- Kit added 6 Oct: `docs/gtm/switch-rescue.md`, `docs/gtm/switch-rescue-tracking.csv`, `scripts/gtm/summarize.ts` (+ `test/gtm-summarize.test.ts`). Gates: 3 rescues, 2 activations, 2 paying; only rescued rows count toward activation and payment.
- Owner still has to review the offer paragraph, confirm the real keyword-export column names (S15), and do all outreach personally (H9).
- Running `pnpm test` in the main checkout also picks up `.claude/worktrees/**` copies while agents are active; use `pnpm vitest run --exclude '.claude/**'`.

- Review of 6 Oct (REVIEW.md): the first draft of the offer overclaimed (open-source, Reddit/GitHub/Stack Overflow, $5 Pro). The doc now lists facts to cover only if true on the day, and the summary script rejects ambiguous rows.

- **Follow-up (re-review, 6 Oct):** the `rescued_on` check is format-only, so an impossible date like `2026-13-45` is accepted; validate it as a real calendar date.
