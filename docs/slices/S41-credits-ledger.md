# S41 — Credits ledger, top-ups and atomic debit

**Track:** Pricing (Idea 5) · **Wave:** 3 · **Size:** L · **Owner:** agent + human (H7) · **Depends on:** S03, S40 · **Unblocks:** S42, S45

## Outcome
Users buy credits (from $5, 1 credit = 1 cent, never expire) and metered actions debit provider cost + 20%, with a visible price before each action.

## Scope
- **DB:** `credit_txn(id uuid, workspace_id, delta_credits numeric(14,4), reason text, cost_event_id uuid nullable, hold_id uuid nullable, stripe_ref text nullable unique, created_at)` append-only, the audit trail; unique index on `credit_txn(hold_id) WHERE reason = 'debit'` so a hold can be debited at most once. `credit_hold(id, workspace_id, credits, expires_at, state)` with `state in ('open','settled','released','expired')`. `credit_balance(workspace_id primary key, balance_credits numeric(14,4) not null default 0 check (balance_credits >= 0), reserved_credits numeric(14,4) not null default 0 check (reserved_credits >= 0 and reserved_credits <= balance_credits))` is the per-workspace counter row that serialises concurrent reserves; it is a projection of `credit_txn` and is only ever changed in the same single statement that inserts the matching `credit_txn`/`credit_hold` row (a top-up upserts it together with its `+credits` txn). A test asserts `balance_credits = sum(credit_txn.delta_credits)` after random sequences.
- **Lib:** `lib/credits/ledger.ts`. neon-http has no interactive transactions, so every write below is ONE statement (a CTE with data-modifying sub-statements) or one `db.batch`; never read-then-write:
  - `quote(provider, action, units)` → `{providerUsd, credits}` with `credits = ceil(providerUsd * 1.20 * 100)` (min 1), prices from `getUnitCost` (S03). `quote` is a conservative upper bound for the action (use the maximum units/steps the call can bill); this is the amount to reserve;
  - `reserve(workspaceId, credits)` → `WITH upd AS (UPDATE credit_balance SET reserved_credits = reserved_credits + $2 WHERE workspace_id = $1 AND balance_credits - reserved_credits >= $2 RETURNING workspace_id) INSERT INTO credit_hold (workspace_id, credits, expires_at, state) SELECT workspace_id, $2, now() + interval '15 minutes', 'open' FROM upd RETURNING id`. Zero rows means insufficient credits. The `UPDATE` row lock makes concurrent reserves for one workspace queue, and under READ COMMITTED the second re-evaluates the `WHERE` against the first one's result, so only one of two competing reserves can succeed. Do not use an aggregate `SELECT sum(...)` check; it does not serialise;
  - `settle(holdId, actualProviderUsd, costEventId)` → one statement: `UPDATE credit_hold SET state='settled' WHERE id=$1 AND state='open' RETURNING credits`, then (from its result) insert the `credit_txn` debit and update `credit_balance` in the same statement (`balance_credits -= debit`, `reserved_credits -= hold.credits`). `debit = least(hold.credits, greatest(1, ceil(actualProviderUsd * 1.20 * 100)))`, the same 20% and rounding as `quote`, computed in integer micro-dollars to avoid float drift. The debit is capped at the hold so the balance can never go negative; if the provider billed more than the hold, the overage is Vantage's cost (visible in `cost_event`, flagged `metadata.overage_credits`) and the hold must be sized from the conservative `quote`. Idempotent: a retry finds the hold no longer `open`, writes nothing, and returns the existing result; the unique `hold_id` debit index backs this up. Settling a hold that already expired is a no-op that logs a `credit_settle_after_expiry` warning (hold TTL must exceed the longest provider timeout);
  - `release(holdId)` on failure → one statement: `UPDATE credit_hold SET state='released' WHERE id=$1 AND state='open'`, and decrement `reserved_credits` by the hold's credits in the same statement (also idempotent);
  - `expireHolds()` → one statement that moves `open` holds with `expires_at <= now()` to `expired` and subtracts their credits from `reserved_credits`; run it from the cron tick and at the start of `reserve` so crashed callers never lock credits forever. Because `reserved_credits` is decremented only by this transition, expired holds are never counted as reserved.
- **Top-ups:** `POST /api/billing/credits/checkout` ($5/$10/$25 one-time Checkout), webhook `checkout.session.completed` (payment mode) inserts `+credits` with `stripe_ref` unique for idempotency (reuses S40 webhook).
- **UI:** balance in header/Settings, history table, "price shown per action" component `app/components/price-tag.tsx`, low-balance notice.
- Rounding policy and the 20% (see DECISION-2026-10-07) documented in `docs/credits.md`; margin check test (credits charged >= provider cost + card fee on a $5 top-up).

## Acceptance criteria
- [ ] Concurrency test: two simultaneous reserves with balance for only one: exactly one succeeds.
- [ ] Settle charges `ceil(actual * 1.20 * 100)` credits (min 1, capped at the hold); settle retried twice debits once; a hold left open past `expires_at` is returned to available credits by `expireHolds()`.
- [ ] Failed provider call releases the hold; no charge (unless `chargedOnFailure`).
- [ ] Webhook replay does not double-credit.
- [ ] Balance never negative (property-style test over random sequences).
- [ ] Works on Free and Pro workspaces.

## Out of scope
Using credits for actions (S42), refunds.
