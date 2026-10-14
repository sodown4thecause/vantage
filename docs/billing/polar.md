# Billing with Polar

contextfor.dev sells the Pro plan through [Polar](https://polar.sh) (merchant of record). The
code uses the official SDK `@polar-sh/sdk` (API version `2026-10`). Polar's Next.js adapter is
not used for checkout: its handler reads `external_customer_id` from the query string, so any
visitor could attribute a purchase to someone else. Our routes take the user from the session.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Products | `lib/billing/products.ts` | Pro monthly and yearly, with a product id per Polar server. Placeholders are refused with "not configured". |
| Checkout | `POST /api/billing/checkout` (`lib/billing/routes.ts`) | Signed-in user only. Accepts a configured product id, creates a checkout with `external_customer_id` = Neon Auth user id, `success_url` = `/success?checkout_id={CHECKOUT_ID}`, and redirects (303). Existing subscribers go to the portal instead. |
| Pricing page | `/pricing` | Free and Pro cards; buy buttons post to the checkout route. Shows checkout errors. |
| Success page | `/success` | Shows "You're on Pro" once the webhook has synced; reads the checkout status from Polar only if the checkout belongs to the signed-in user. |
| Portal | `GET /api/billing/portal` | Creates a Polar customer session for the signed-in user and redirects to the customer portal (manage, cancel, invoices). Linked from Plan & usage. |
| Webhooks | `POST /api/webhooks/polar` (`lib/billing/webhook.ts`) | Verifies the Standard Webhooks signature with `POLAR_WEBHOOK_SECRET`; handles `checkout.updated`, `order.paid`, `subscription.created/updated/active/canceled/revoked`; dedupes by `webhook-id`; re-fetches the canonical subscription from Polar before writing, so out-of-order deliveries cannot write stale state. |
| Entitlement | `lib/billing/entitlement.ts`, `lib/plans/limits.ts` | A user is Pro while a Pro subscription is `active`, `trialing` or `past_due` and not ended. A workspace is Pro when its owner is, or an operator set `workspace.plan = 'pro'`. Every limit and paid feature reads this server-side. |
| Tables | `drizzle/0023_robust_peter_parker.sql` | `billing_subscription`, `billing_order`, `billing_webhook_event` (additive). |

Webhook responses: 403 bad signature, 400 malformed, 202 processed or ignored type, 200 duplicate,
409 while another run holds the event, 500 on failure (the claim is released so Polar's retry
reprocesses it), 503 when the secret is missing.

## Configure Polar (sandbox first)

Do these in the **sandbox** organization (sandbox.polar.sh). Repeat in production only after the
owner confirms going live.

1. **Products.** Create two recurring products: "Pro" monthly ($5/month) and "Pro" yearly
   ($48/year), or the prices you decide (currency is an open owner decision; USD was
   recommended). Copy each product id into `lib/billing/products.ts` under `sandbox`.
2. **Access token.** Settings → Developers → New token (organization access token). Scopes:
   `checkouts:write`, `checkouts:read`, `customer_sessions:write`, `subscriptions:read`,
   `customers:read`, `orders:read`, `products:read`. Store it as `POLAR_ACCESS_TOKEN`.
3. **Webhook endpoint.** Settings → Webhooks → Add endpoint:
   `https://<staging host>/api/webhooks/polar` (production: `https://www.contextfor.dev/api/webhooks/polar`),
   format **Raw**, events: `checkout.updated`, `order.paid`, `subscription.created`,
   `subscription.updated`, `subscription.active`, `subscription.canceled`, `subscription.revoked`.
   Store the shown secret (`whsec_…`) as `POLAR_WEBHOOK_SECRET`.
4. **Server.** `POLAR_SERVER=sandbox` (anything except exactly `production` is the sandbox).
5. **Worker secrets.** On the staging Worker:
   `wrangler secret put POLAR_ACCESS_TOKEN --env staging`, same for `POLAR_WEBHOOK_SECRET`, and
   set `POLAR_SERVER` (var or secret). Production only after sign-off.
6. **Database.** Apply migration `0023` (and `0022` if still pending) to the Neon branch:
   `pnpm db:migrate` against the direct (non-pooler) endpoint.
7. **OAuth app.** The "ContextFor.dev" OAuth app is not needed for this flow, which uses an
   organization access token. Keep it for a future "connect your Polar account" feature.

## Test locally against the sandbox

1. `.env.local`: sandbox `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER=sandbox`,
   `NEXT_PUBLIC_APP_URL=http://localhost:3000`, plus the usual database and Neon Auth values.
2. `pnpm dev`, sign in, open `/pricing`, click **Upgrade to Pro**: you land on a sandbox checkout.
   Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC.
3. Forward webhooks to your machine, either:
   - Polar CLI: `polar listen http://localhost:3000/api/webhooks/polar` (prints a secret to use as
     `POLAR_WEBHOOK_SECRET` for local runs), or
   - ngrok: `ngrok http 3000`, then point a sandbox webhook endpoint at
     `https://<id>.ngrok-free.app/api/webhooks/polar`.
4. Check: `/success` turns into "You're on Pro"; Plan & usage shows Pro limits; rows exist in
   `billing_subscription` and `billing_webhook_event`. Cancel from **Manage or cancel your
   subscription**; the plan stays Pro until Polar sends `subscription.revoked`, then returns to Free.
   Redeliver an event from the Polar dashboard: the endpoint answers 200 `{"duplicate":true}`.

## Going live (only after owner confirmation)

Production organization: create the same products, put their ids under `production` in
`lib/billing/products.ts`, create a production access token and webhook endpoint, set the
production Worker secrets and `POLAR_SERVER=production`, apply the migrations to Neon `main`.
