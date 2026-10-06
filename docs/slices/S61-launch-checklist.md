# S61 — Launch checklist and venue-rules check

**Track:** Go-to-market · **Wave:** 5 · **Size:** S · **Owner:** human-led, agent prepares · **Depends on:** S16, S21, S30 (and S50/S51/S52 for the skill launch) · **Target:** early December 2026

## Outcome
A dated, venue-by-venue launch plan where every post respects the venue's rules.

## Scope (agent)
- `docs/gtm/launch.md`: order of launch (Show HN, Product Hunt, r/selfhosted, r/opensource, DEV.to; **skip r/SaaS**), per-venue rules summary pulled from the Rules Index (S30) with last-checked dates and links, prerequisites checklist (Radar live, pricing page, tracker, promise page, importer, skill package), assets list (screenshots from staging, OG images, short demo recording), metrics to watch (visitor to scan, scan to signup, GitHub stars, weekly installs, pack PRs, Free to Pro), rollback and support plan (switches, status page, who answers comments).
- Show HN: **the owner writes the post and all replies themselves**. The agent may provide a factual bullet list of what the product does and honest limitations, but no post or comment text. Reddit launches likewise written by the owner after re-reading each rule page that day.
- Pre-launch load test script `scripts/load/radar.ts` (k6 or simple fetch loop) hitting staging with the guard on, to confirm the daily budget cap and rate limits hold.

## Acceptance criteria
- [ ] Checklist reviewed by owner; every venue row has a rule source and checked-on date.
- [ ] Load test report committed (guard held, spend <= cap).
