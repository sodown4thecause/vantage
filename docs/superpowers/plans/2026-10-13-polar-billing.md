# Plan: Polar billing (checkout, webhooks, portal, server-side gating)

Owner request (13 Oct 2026): payments for contextfor.dev with Polar (polar.sh), sandbox first,
no live keys until the owner confirms. This replaces the Stripe-based S40 for subscriptions.
Note: `docs/slices/DECISION-2026-10-07-login-first-usage-billing.md` dropped the Pro
subscription in favour of credits; the owner's new request reinstates a Pro subscription.
Credit top-ups can later be one-time Polar products (order.paid is already recorded).

## Facts checked
- SDK `@polar-sh/sdk` 1.0.2, API version `2026-10`: `createPolar({ accessToken, environment })`,
  snake_case bodies (`checkouts.create({ products, external_customer_id, success_url })`,
  `customerSessions.create({ external_customer_id })` → `customer_portal_url`,
  `subscriptions.get(id)`), `webhooks.validateEvent(body, headers, secret)`.
- Webhooks use Standard Webhooks headers; `webhook-id` is stable across retries (dedupe key).
- `subscription.updated` is the catch-all; access ends at `subscription.revoked`; a cancel at
  period end keeps status `active` with `cancel_at_period_end = true`.
- The `@polar-sh/nextjs` Checkout handler reads `external_customer_id` from the query string,
  so any visitor could attribute a purchase to another user. We use the SDK directly and take
  the user id from the server session.
- Payload parsing is lenient, so subscription events re-fetch the canonical subscription
  (S40's out-of-order rule) instead of trusting payload fields.

## Design
- `billing_subscription` (Polar subscription id, user id = external customer id, product, plan,
  status, period end, cancel flag, ended_at, Polar modified_at), `billing_order`,
  `billing_webhook_event` (webhook-id primary key; claim → process → mark processed; a failed
  run releases its claim so Polar's retry reprocesses). Additive migration.
- Entitlement: a user is Pro while a `plan = 'pro'` subscription is `active`, `trialing` or
  `past_due` and not ended. A workspace's effective plan is Pro when `workspace.plan = 'pro'`
  (manual grant) or its owner is entitled. `getWorkspacePlan`, `consume()` and
  `assertCanCreateProject` use it, so every limit and paid feature is gated server-side.
- Routes: `POST /api/billing/checkout` (session user, allow-listed product id, refuses a second
  live subscription by sending the user to the portal), `GET /api/billing/portal`,
  `POST /api/webhooks/polar`. Pages: `/pricing`, `/success`; Plan page links to both.
- Products live in `lib/billing/products.ts` with placeholders per server; placeholders are
  refused with a clear "not configured" message.

## Verification
Vitest: signature rejection, unknown types, dedupe/claim release, each event type, canonical
re-fetch, entitlement SQL scoping, checkout/portal auth and allow-list. Lint, typecheck, build,
migration drift. Sandbox end-to-end needs egress to `sandbox-api.polar.sh` (blocked in this
session) or a local run with the Polar CLI / ngrok forwarding to `/api/webhooks/polar`.
