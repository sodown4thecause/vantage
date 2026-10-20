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

No schema changes, automatic workspace creation, email-policy changes, or production
data edits are needed. Leave implementation uncommitted unless asked to publish it.
