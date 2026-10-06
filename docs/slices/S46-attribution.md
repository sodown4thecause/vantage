# S46 — Signup attribution and cost per signup

**Track:** Pricing/Growth (Idea 5) · **Wave:** 4 · **Size:** S · **Owner:** agent · **Depends on:** S23, S40 · **Unblocks:** S44 metrics

## Outcome
Cost per lead becomes cost per signup and per paying customer for each channel (radar, pack page, skill, alternative pages, direct).

## Scope
- First-party `vantage_src` cookie set from `utm_*`, `ref`, landing path and radar scan id (no third-party trackers, no PII); consent-light because no cross-site tracking (document in privacy page).
- Persist on signup (`workspace.signup_source`, from S23); join `cost_event` (workspace-attributed) and Stripe revenue to compute per-channel CAC-like numbers in the rollup (S44).
- Admin table `/admin/attribution`.

## Acceptance criteria
- [ ] Tests for cookie parsing and rollup join; privacy statement updated.
- [ ] Free-to-paid conversion metric (target: 1 in 20 within 90 days) computed and shown in admin.
