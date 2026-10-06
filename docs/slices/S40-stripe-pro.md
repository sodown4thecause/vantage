# S40 — Stripe Pro subscription, portal and webhooks

**Track:** Pricing (Idea 5) · **Wave:** 2 · **Size:** L · **Owner:** agent + human (H7) · **Depends on:** none · **Unblocks:** S41, S45, S46

## Outcome
A Free user can upgrade to Pro ($5/month or $48/year), manage or cancel in one click, and the plan flips automatically via webhooks.

## Scope
- **Human (H7):** Stripe account (Australian), products/prices (`pro_monthly` $5, `pro_yearly` $48), webhook endpoint, secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`. Test mode first.
- **DB:** `billing_customer(workspace_id pk, stripe_customer_id unique, ...)`, `billing_subscription(id, workspace_id, stripe_subscription_id unique, status, price_id, current_period_end, cancel_at_period_end, updated_at)`, `stripe_event(id pk, type, processed_at)` for idempotency.
- **Lib:** `lib/billing/stripe.ts` using plain `fetch` to the Stripe REST API (no SDK, Workers-friendly; or the official SDK with `Stripe.createFetchHttpClient()` if justified), `lib/billing/webhook.ts` (verify signature with Web Crypto HMAC-SHA256 and a 5-minute tolerance, handle `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`), `lib/billing/plan.ts` (`syncPlanFromSubscription` sets `workspace.plan`).
- **API:** `POST /api/billing/checkout` (authorized; returns Checkout URL), `POST /api/billing/portal`, `POST /api/stripe/webhook` (raw body, no auth, signature only).
- **UI:** `/pricing` upgrade buttons (page itself is S43), Settings → Billing panel (plan, renewal date, "Manage / cancel").
- **Reminders:** record `renewal_reminder_due_at`; email sending is in S45.

## Acceptance criteria
- [ ] Webhook tests: bad signature rejected, replayed event ignored (idempotent), each event type updates plan correctly, out-of-order events resolved by `updated_at`.
- [ ] Test-mode e2e on staging: upgrade, plan becomes `pro`, cancel via portal, plan returns to `free` at period end.
- [ ] No card data touches our servers; no secrets logged.
- [ ] Cancel is one click from Settings.

## Out of scope
Credits (S41), tax/GST invoicing details (owner decision), refunds UI.
