# S23 — Radar to account handoff

**Track:** Radar (Idea 2) · **Wave:** 4 · **Size:** S · **Owner:** agent · **Depends on:** S21 · **Unblocks:** S46

## Outcome
"Keep watching every 3 hours" saves the generated pack, creates the account, and drops the user into onboarding with everything prefilled.

## Scope
- On CTA click (`POST /api/radar/[scanId]/claim`, behind the S06 guard) copy the scan's `pack` jsonb into a private `monitor_pack` row (S20; `owner_workspace_id` null, validated by `lib/packs/validate.ts`) so the handoff no longer depends on the `radar_scan` row, which may expire first (S21 sets no retention). Migration adds `monitor_pack.claim_token_hash text nullable` and `claim_expires_at timestamptz nullable` (now + 30 days); unclaimed rows past `claim_expires_at` are pruned by the cron tick.
- **Claim credential:** generate a random 32-byte secret per claim, store only its SHA-256 in `claim_token_hash`, and return it once as an `httpOnly`, `Secure`, `SameSite=Lax` first-party cookie `vantage_claim=<packId>.<secret>` (30 days, no PII). Never authorize from the public scan id or from S06's daily-salted visitor hash (it changes at midnight). Also set the shared `vantage_src` cookie (S46's allow-listed format, channel `radar`, scan id as UUID) for attribution.
- After sign-up (`app/auth/[path]` flow) redirect to `/onboarding?from=radar`; `app/onboarding/page.tsx` reads `vantage_claim`, verifies the secret (constant-time hash compare) in `lib/radar/handoff.ts`, then calls `applyPackToWorkspace(workspaceId, packId)` (S20) to prefill product URL, description, competitors, topics and keywords (within Free limits) and create sources. On success set `owner_workspace_id`, clear `claim_token_hash` and the cookie. A missing, expired, mismatched or already-claimed credential falls through to normal onboarding with a visible "we could not restore your scan" notice, never an error page.
- Other visitors cannot claim or read the pack; they only see the scan's read-only public data.
- Write `workspace.signup_source` jsonb (`{channel:'radar', scanId, referrer?}`) (migration) for S46.

## Acceptance criteria
- [ ] Test: claiming with a wrong secret, with only the public scan id, or after `claim_expires_at` is refused; a claim made on day 1 still works on day 29 (daily visitor-hash rotation does not matter) and after the `radar_scan` row is deleted.
- [ ] Onboarding prefill test with a fixture pack; over-limit keywords trimmed with a visible notice.
- [ ] Anonymous-to-account flow works on staging end to end (record steps in PR).
