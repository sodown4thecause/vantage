# S23 — Radar to account handoff

**Track:** Radar (Idea 2) · **Wave:** 4 · **Size:** S · **Owner:** agent · **Depends on:** S21 · **Unblocks:** S46

## Outcome
"Keep watching every 3 hours" saves the generated pack, creates the account, and drops the user into onboarding with everything prefilled.

## Scope
- Store `radar_scan_id` and a `signup_source` cookie (first-party, 30 days, no PII) when a visitor clicks the CTA.
- After sign-up (`app/auth/[path]` flow) redirect to `/onboarding?from=radar&scan=<id>`; `app/onboarding/page.tsx` loads the scan's pack (`lib/radar/handoff.ts`), prefilling product URL, description, competitors, topics, keywords (within Free limits) and creating sources via `applyPackToWorkspace` (S20).
- Only the scan's creator (same visitor hash/cookie) can claim it; other visitors see read-only public data.
- Write `workspace.signup_source` jsonb (`{channel:'radar', scanId, referrer?}`) (migration) for S46.

## Acceptance criteria
- [ ] Test: claiming a scan from another visitor is refused.
- [ ] Onboarding prefill test with a fixture pack; over-limit keywords trimmed with a visible notice.
- [ ] Anonymous-to-account flow works on staging end to end (record steps in PR).
