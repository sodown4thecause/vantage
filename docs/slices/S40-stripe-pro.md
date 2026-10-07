# S40 — Stripe Pro subscription, portal and webhooks

**Track:** Pricing (Idea 5) · **Wave:** 2 · **Size:** L · **Owner:** agent + human (H7) · **Depends on:** none · **Unblocks:** S41, S45, S46

## Outcome
A Free user can upgrade to Pro ($5/month or $48/year), manage or cancel in one click, and the plan flips automatically via webhooks.

## Scope
- **Human (H7):** Stripe account (Australian), products/prices (`pro_monthly` 5.00 and `pro_yearly` 48.00 in **USD**, set explicitly as `currency=usd` on both prices; checkout, pricing copy and the Open Ledger use the same currency), webhook endpoint, secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`. Test mode first.
  **Decision (owner, H10):** price currency. Options: USD (matches every public figure in this plan, international audience; Stripe converts card payments, A$ payout) or AUD (Australian account, local buyers). Recommendation: USD, optionally adding an AUD `currency_options` entry later. Do not create prices until the owner confirms.
- **DB:** `billing_customer(workspace_id pk, stripe_customer_id unique, ...)`, `billing_subscription(id, workspace_id, stripe_subscription_id unique, status, price_id, current_period_end, cancel_at_period_end, updated_at)`, `stripe_event(id pk, type, processed_at)` for idempotency. Add a partial unique index on `billing_subscription(workspace_id) WHERE status IN ('active','trialing','past_due','unpaid')` so a workspace can never hold two live subscriptions.
- **Lib:** `lib/billing/stripe.ts` using plain `fetch` to the Stripe REST API (no SDK, Workers-friendly; or the official SDK with `Stripe.createFetchHttpClient()` if justified), `lib/billing/webhook.ts` (verify signature with Web Crypto HMAC-SHA256 and a 5-minute tolerance, handle `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`), `lib/billing/plan.ts` (`syncPlanFromSubscription` sets `workspace.plan`). **Event ordering:** webhooks arrive out of order and `updated_at` (our own clock) says nothing about Stripe order, so no handler trusts the event payload for state. Every subscription-related event (`customer.subscription.*`, `invoice.*`, `checkout.session.completed`) only triggers a refetch of the canonical subscription (`GET /v1/subscriptions/{id}`) and an upsert of `billing_subscription` from that response, then `workspace.plan` is recomputed from the stored rows (`pro` iff the workspace has a subscription with status `active`, `trialing` or `past_due`, otherwise `free`), never from the event type. A stale event therefore re-reads current state and is harmless; a 404 for a deleted subscription marks it `canceled`.
- **API:** `POST /api/billing/checkout` (authorized; returns Checkout URL; refuses with 409 and a portal link if the workspace already has a live subscription, reuses the workspace's `stripe_customer_id`, and sets `client_reference_id`/metadata to the workspace id; a double-click creates at most one session per workspace per minute via an idempotency key), `POST /api/billing/portal`, `POST /api/stripe/webhook` (raw body, no auth, signature only).
- **UI:** `/pricing` upgrade buttons (page itself is S43), Settings → Billing panel (plan, renewal date, "Manage / cancel").
- **Reminders:** record `renewal_reminder_due_at`; email sending is in S45.

## Acceptance criteria
- [ ] Webhook tests: bad signature rejected, replayed event ignored (idempotent), each event type updates plan correctly, out-of-order events (a stale `subscription.updated` after `deleted`) cannot overwrite canonical state because the handler refetches the subscription (Stripe mocked).
- [ ] A second checkout for a workspace with a live subscription is refused; cancelling one subscription row cannot downgrade a workspace that still has another live one (index test).
- [ ] Test-mode e2e on staging: upgrade, plan becomes `pro`, cancel via portal, plan returns to `free` at period end.
- [ ] No card data touches our servers; no secrets logged.
- [ ] Cancel is one click from Settings.

## Out of scope
Credits (S41), tax/GST invoicing details (owner decision), refunds UI.
