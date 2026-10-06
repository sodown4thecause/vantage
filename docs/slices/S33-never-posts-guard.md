# S33 — "Never writes or posts" guard test and brand copy

**Track:** Reply Briefs (Idea 3) · **Wave:** 5 · **Size:** S · **Owner:** agent · **Depends on:** S31, S32 · **Unblocks:** S61

## Outcome
The headline promise "Vantage never writes or posts your comments" is true in code, enforced by a test, and stated on the site.

## Scope
- `test/never-posts.test.ts`: static scan of `app/`, `lib/` for outbound calls that mutate third-party platforms: HTTP methods other than GET/HEAD to known platform hosts (reddit.com, ycombinator.com, news.ycombinator.com, api.github.com POST/PUT/PATCH/DELETE, x.com/api.x.com, bsky, dev.to POST, lobste.rs POST); allow-list is explicit and reviewed. Also fails if any module named like `post*`, `publish*` or `autopilot*` is added without allow-list entry.
- Site copy page `/promise` and a hero line: "Vantage never writes or posts for you. No autopilot, no rented accounts, no humanizer, posts only from your own account." with a list of what it won't do. Facts per the review's competitor notes must be sourced and dated if named.
- Add a "Our promise" link in the footer (`app/layout.tsx`).

## Acceptance criteria
- [ ] Guard test passes on main and fails when a deliberate `fetch("https://www.reddit.com/api/comment", {method:"POST"})` is added (proved in PR description, then removed).
- [ ] Copy reviewed by owner.
