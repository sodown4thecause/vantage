# S41 — Credits ledger, top-ups and atomic debit

**Track:** Pricing (Idea 5) · **Wave:** 3 · **Size:** L · **Owner:** agent + human (H7) · **Depends on:** S03, S40 · **Unblocks:** S42, S45

## Outcome
Users buy credits (from $5, 1 credit = 1 cent, never expire) and metered actions debit provider cost + 15%, with a visible price before each action.

## Scope
- **DB:** `credit_txn(id uuid, workspace_id, delta_credits numeric(14,4), reason text, cost_event_id uuid nullable, stripe_ref text nullable unique, created_at)` append-only; balance = sum. `credit_hold(id, workspace_id, credits, expires_at, state)` for reserve/settle.
- **Lib:** `lib/credits/ledger.ts`:
  - `quote(provider, action, units)` → `{providerUsd, credits}` with `credits = ceil(providerUsd * 1.15 * 100)` (min 1), prices from `getUnitCost` (S03);
  - `reserve(workspaceId, credits)` → one atomic statement `INSERT INTO credit_hold ... SELECT ... WHERE (SELECT coalesce(sum(delta_credits),0) FROM credit_txn WHERE workspace_id=$1) - (SELECT coalesce(sum(credits),0) FROM credit_hold WHERE workspace_id=$1 AND state='open') >= $2 RETURNING id`;
  - `settle(holdId, actualProviderUsd, costEventId)` writes the debit for the actual cost and releases the rest; `release(holdId)` on failure.
- **Top-ups:** `POST /api/billing/credits/checkout` ($5/$10/$25 one-time Checkout), webhook `checkout.session.completed` (payment mode) inserts `+credits` with `stripe_ref` unique for idempotency (reuses S40 webhook).
- **UI:** balance in header/Settings, history table, "price shown per action" component `app/components/price-tag.tsx`, low-balance notice.
- Rounding policy and the 15% documented in `docs/credits.md`; margin check test (credits charged >= provider cost + card fee on a $5 top-up).

## Acceptance criteria
- [ ] Concurrency test: two simultaneous reserves with balance for only one: exactly one succeeds.
- [ ] Failed provider call releases the hold; no charge (unless `chargedOnFailure`).
- [ ] Webhook replay does not double-credit.
- [ ] Balance never negative (property-style test over random sequences).
- [ ] Works on Free and Pro workspaces.

## Out of scope
Using credits for actions (S42), refunds.
