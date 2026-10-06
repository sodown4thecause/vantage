# Vantage review rules

Vantage is an opportunity-detection product: collect public posts, rank a few
strong opportunities, draft a grounded reply, and hand it to a human. Review
for these product invariants before style.

- **No autonomous publishing.** Nothing may post, reply or send on a user's
  behalf. Drafts are copied or opened manually.
- **No fixtures in production.** Fixture or synthetic content must never reach
  `document`, opportunities, drafts or the queue outside tests. Missing keys are
  `access_pending`, exhausted budget is `budget_limited`, provider errors are
  failures. Never fabricate a successful result.
- **Paid lanes stay bounded.** Any call to Scavio, TinyFish or other paid
  providers must check workspace consent and monthly budget first, and have an
  explicit timeout. Paid collection is disabled in production by default.
- **Tenant isolation.** Every query touching workspace data must be scoped by an
  owned `workspaceId`, checked against the current user. Flag routes that take a
  `workspaceId` without an ownership check.
- **Bounded scans.** Outbound fetches need deadlines and size limits, and user
  supplied URLs must be validated as public (no private or loopback ranges).
  Scheduled work must respect the per-workspace scan lease.
- **Queue limits.** At most five cards; an empty queue is valid. Do not pad it.
- **Learning stays off** unless `VANTAGE_LEARNING_ENABLED` is explicitly set.
- **Secrets.** Nothing secret in code, logs, build output or `NEXT_PUBLIC_*`.
  Runtime secrets live in Cloudflare Worker secrets.
- **Migrations.** Schema changes need a generated Drizzle migration committed
  with the change. Flag destructive migrations.
- **Cloudflare Workers runtime.** No Node-only APIs on Worker code paths, and
  no new dependency that bloats the Worker bundle without justification.
