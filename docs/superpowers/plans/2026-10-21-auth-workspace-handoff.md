# Auth workspace handoff

Production has registered users and sessions but no workspaces. Email verification
is disabled in Neon, so signup currently sends no verification email. Keep those
settings unchanged; this change fixes the application handoff, not email policy.

1. Add regression coverage for missing sessions, new accounts, existing workspace
   owners, failed workspace creation, and authenticated workspace ownership.
2. Send successful authentication to a dynamic `/setup` page with a fresh document
   navigation. Route existing owners to their queue or monitoring profile. Give
   accounts without a workspace an explicit setup form and visible submission state.
3. Replace the homepage's embedded workspace form with the same setup handoff.
   Keep workspace creation behind the existing authenticated, owner-scoped action.
4. Run lint, typecheck, Vitest, Worker node tests, and build. Inspect the rendered
   setup and recovery screens in a browser. Verify real authentication and workspace
   creation only against a configured environment; do not claim mocked checks are
   a successful production login.

Sailer expanded the scope to support additional workspaces up to the existing plan
cap and a workspace switcher. Persist the selection in an HTTP-only cookie, validate
ownership on every selection, and ignore cookies pointing to another owner's or a
deleted workspace. Keep first-workspace retries idempotent.

No schema changes, automatic workspace creation, email-policy changes, or production
data edits are needed. Publish one PR against main under the crew rules. Staging-only
verification with disposable account data is approved; shared auth settings stay unchanged.
