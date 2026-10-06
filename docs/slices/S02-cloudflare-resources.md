# S02 — Queues, R2, rate-limit, Browser and Workflow bindings

**Track:** Platform · **Wave:** 0 · **Size:** S · **Owner:** human (H3) + agent · **Depends on:** S00 · **Unblocks:** S11, S21, S22

## Outcome
`wrangler.jsonc` declares every Cloudflare resource the later slices need, per environment, and the Worker deploys with them.

## Scope
- **Human (H3):** extend the Cloudflare token: Queues: Edit, Workflows: Edit, Browser Rendering: Edit, R2: Edit, and (if used) Account Analytics. Upgrade to Workers Paid.
- Create (CLI or API): queues `vantage-sweep-jobs` + `vantage-sweep-dlq` (and `-staging` variants), R2 bucket `vantage-assets` (+ `-staging`).
- `wrangler.jsonc` (both envs, with staging-suffixed names): `queues.producers/consumers` (consumer `max_batch_size: 10`, `max_retries: 2`, DLQ), `r2_buckets` binding `ASSETS_BUCKET`, `browser` binding `BROWSER` (`"remote": true` for dev), `ratelimits` binding `RADAR_LIMITER` (simple limit, e.g. 5 per 60s; confirm current syntax in Cloudflare docs before writing), `workflows` binding `RADAR_SCAN` (class implemented in S21; add the binding in S21 if the class does not exist yet).
- `worker-entry.mjs`: export a `queue(batch, env)` handler that **re-enters the OpenNext bundle via `WORKER_SELF_REFERENCE`** (same pattern as `scheduled`), POSTing the batch to `/api/internal/queue` with `Authorization: Bearer ${CRON_SECRET}`. Add that route as a stub returning 200 for an empty batch. Add tests next to `test/worker-entry.test.mjs`.
- Run `pnpm cf:typegen`; commit `cloudflare-env.d.ts` if the repo tracks it (check `.gitignore`).

## Acceptance criteria
- [ ] `pnpm exec wrangler deploy --dry-run --env staging` shows all new bindings.
- [ ] Staging deploys; a test message sent to the queue reaches `/api/internal/queue` (log line).
- [ ] CI `workers-build` still green without secrets.
- [ ] Production config mirrors staging with production names.

## Out of scope
Consumers' real logic (S11), the Workflow class (S21), Turnstile (S06).

## Gotchas
Queue consumers must not import app code directly (would duplicate the bundle). The `browser` binding needs compatibility date >= 2026-03-24 for `quickAction` (current 2026-10-05).
