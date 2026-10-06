# S42 — X (Grok) and ScrapeCreators sources on credits

**Track:** Pricing/Sources (Ideas 1, 5) · **Wave:** 4 · **Size:** L · **Owner:** agent + human (H6) · **Depends on:** S04, S41 · **Unblocks:** Pro value

## Outcome
Pro and Free users can run X scans and LinkedIn/Facebook/Instagram checks, paying only provider cost + 15% in credits, with hard post caps so one heavy user cannot sink the plan.

## Scope
- **Providers:** X via xAI Grok `x_search` (licensed route): `lib/x/grok.ts` (`from_date` set to yesterday, keyword mode, bill from `x_posts_fetched`, parent/quoted posts count; monthly post cap per user; use `grok-4.7` for the insight call). LinkedIn keyword post search, Instagram reel search, Facebook public group/page posts via ScrapeCreators (`lib/scrapecreators/client.ts`, $0.0019/request, 3 posts/request for Facebook); Scavio as fallback (already in repo: `lib/scavio/client.ts`).
- **Source types:** `linkedin`, `facebook`, `instagram` added (README section 2 item 8); `x` already exists (replace the Scavio-first path with Grok-first, keep Scavio fallback).
- **Flow:** every run = `quote()` → show price → `reserve()` → run → `settle()` (S41); never run without a hold. Production guard in `lib/collectors/run.ts` allows paid lane only with a hold.
- **Switches:** separate switches `x`, `linkedin`, `facebook`, `instagram` (S04); none bundled "unlimited".
- **UI:** "Run X scan (about 17 credits)" buttons with live balance; Pro includes the sources via credits only.
- Weekly X pulse (shared, `~$14/month` for all users): `lib/x/pulse.ts` run by cron, stored as `shared_post` rows, shown to Free users.

## Acceptance criteria
- [ ] Tests: quote accuracy vs fixtures (25-post X scan about 17 credits; ScrapeCreators 0.22 credits), post cap enforced, hold released on provider failure, switch off blocks.
- [ ] Staging run with real keys costs recorded; margin >= 6% verified per action (record numbers in PR).
- [ ] Every source shows its own paused/blocked state.

## Out of scope
Auto-posting (never). Bundled unlimited plans (explicitly rejected in the review).
