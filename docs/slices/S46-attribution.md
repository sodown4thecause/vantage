# S46 — Signup attribution and cost per signup

**Track:** Pricing/Growth (Idea 5) · **Wave:** 4 · **Size:** S · **Owner:** agent · **Depends on:** S23, S40 · **Unblocks:** S44 metrics

## Outcome
Cost per lead becomes cost per signup and per paying customer for each channel (radar, pack page, skill, alternative pages, direct).

## Scope
- First-party `vantage_src` cookie stores only bounded, allow-listed values: `utm_source`/`utm_medium`/`utm_campaign` and `ref` must match `^[a-z0-9_-]{1,40}$` after lower-casing and, when a channel allow-list exists (`radar`, `pack`, `skill`, `alternatives`, `direct`, plus named campaigns in a config file), anything else is stored as `other`; the landing path is the route pattern only (query string, fragment and ids stripped, e.g. `/radar/[owner]/[repo]`, at most 80 chars); the radar scan id must be a UUID. Never persist arbitrary input (no third-party trackers, no PII); consent-light because no cross-site tracking (document in privacy page).
- Persist on signup (`workspace.signup_source`, from S23); join cost and Stripe revenue: workspace-attributed `cost_event` rows by `workspace_id`, plus anonymous radar scan costs by joining `signup_source.scanId` to `cost_event.request_ref` (S21 records scan costs with `request_ref = scanId` and a null `workspace_id`), counting each cost event once; and Stripe revenue to compute per-channel CAC-like numbers in the rollup (S44).
- Admin table `/admin/attribution`.

## Acceptance criteria
- [ ] Tests for cookie parsing (an email in `utm_campaign`, a 200-char value, a path with a query string and a non-UUID scan id are all rejected or normalised) and for the rollup join (a radar-origin signup's cost-per-signup includes its scan's null-workspace cost events); privacy statement updated.
- [ ] Free-to-paid conversion metric (target: 1 in 20 within 90 days) computed and shown in admin.
