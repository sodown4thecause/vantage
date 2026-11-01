# GitHub issue handoff

Issue: https://github.com/sodown4thecause/vantage/issues/178
Labels: `agent-ready`, `vertical-slice`.
Status: awaiting Liam’s approval; no coding authorised.

## Goal / approval checkpoint
**Planning only; wait for Liam's OK before coding. XL overall → six PRs, each S/M.**

An agent starts a restricted Vantage trial, reads conversation evidence and prepares private text; a human signs in with **existing Neon Auth** and claims that workspace. Also support ordinary Claude Code/Codex browser login with OAuth 2.1 + PKCE (proof the approving browser flow belongs to the client that started it).

**Staging only.** `AGENT_REGISTRATION_ENABLED` defaults off and also requires the staging deployment. No production deploys/migrations, WorkOS AuthKit, posting/replies/DMs, billing changes or access to other workspaces. Accept only anonymous registration initially, not external ID-JAG assertions or `service_auth`. Anonymous auth.md still needs a Vantage-signed assertion exchanged for a short-lived token.

Client zero: **contextfor.dev**, including evidence for Liam's case study. It is the product being researched, not permission to enable these endpoints in production. A custom staging subdomain needs separate approval/configuration.

## One PR per slice; review between slices
- [ ] **AR00 · S — compatibility proof.** Local/mocked Worker proof of Neon login + PKCE and separate anonymous auth.md grants; settle issuer/metadata routing, maintained library, storage, pinned client versions and exact configuration list. Managed Neon does not expose custom anonymous grants. Stop for design review if the integration cannot fit; no auth migration or infrastructure setup.
- [ ] **AR01 · M — human-connected access.** Revocable workspace-specific permissions, Neon consent/PKCE, both OAuth discovery documents and Streamable HTTP `/mcp` with `get_workspace_context`. Test login/code replay, wrong audience/issuer, revocation, workspace isolation, flag-off and production refusal.
- [ ] **AR02 · M — useful tools.** Today's ranked conversations (UTC initially), one conversation with evidence, and `draft_reply` returning text only. Reuse shared authorised services; enforce source grounding/venue policy. Prohibited AI-reply venues get research-only output. Test cross-workspace denial before provider calls, honest empty results, bounded/costed generation and no save/send side effect. Depends on existing S03/S04 safety work; coordinate with #139.
- [ ] **AR03 · M — anonymous trial.** Registration → signed assertion → token exchange/revocation, durable audit, hard quotas and cron cleanup. Proposed: one workspace, one explicitly requested server-owned setup scan, seven days, 15-minute access tokens, ten draft attempts. No general scan/write permission or recurring scans/digests. RADAR_LIMITER by trusted IP/registration plus durable database caps; deny if unavailable. Test concurrency, idempotency, quota bypass, expiry and cleanup on both cron paths. **Trial spend defaults to $0**; paid scoring/drafting needs a separately approved staging allowance.
- [ ] **AR04 · M — human claim.** Ten-minute code/link, verified Neon login matching intended email, explicit confirmation and atomic ownership transfer respecting project limits/account plan. No claim on GET, surprise default workspace or automatic upgrade. Replace credentials; old assertions/tokens stop working. Test wrong account, CSRF, expiry/replay, competing claims and cleanup races.
- [ ] **AR05 · M — packaging + proof.** Minimal Claude plugin/Codex config, one-line setup commands, auth.md onboarding instructions and truthful `/auth.md`. Install must not register/spend silently. Redacted staging walkthrough: register → token → tool → human claim → old credential denied → new credential works; also actual pinned Claude/Codex PKCE connections. Do not assume either client natively automates auth.md. Record screenshots for review/case study, without secrets/private content.

## Configuration — list only, provision nothing
Proposed new variables: `AGENT_REGISTRATION_ENABLED`, `AGENT_REGISTRATION_ORIGIN`, `AGENT_ASSERTION_KEY_ID`, `AGENT_TRIAL_BUDGET_USD`, `AGENT_TRIAL_GLOBAL_BUDGET_USD` (budgets zero).
New secret: `AGENT_ASSERTION_SIGNING_KEY`.
Reuse staging `DATABASE_URL`, `NEON_AUTH_*`, `CRON_SECRET`, `VISITOR_SALT`, `RADAR_LIMITER` and approved provider settings. A Cloudflare OAuth-library choice would additionally require a staging `OAUTH_KV` namespace/binding; managed Neon OAuth instead needs its staging provider/resource/client setup. **AR00 finalises the exact list before any setup. No WorkOS keys.**

## Delivery safeguards
Remote main checked **1 November 2026**, `84fe2c9`: latest migration **0035_daily_impossible_man**, journal 35. Re-fetch main before each schema PR; generate the next available migration + snapshot, never guess. No migration application authorised now, including staging.

Run repository checks and Worker/dataflow tests appropriate to each slice; report unrun checks, calls/costs and migration number. Fresh implementation branches from current main; inspect dependencies on unmerged readiness fixes. Stop/report after the same error twice; never blindly retry uncertain registrations/claims/spend. Staging accounts, deployment, migration application and paid walkthrough require separate owner permission.

Read first: [spec](https://auth-md.com/specification), [WorkOS guide](https://workos.com/auth-md/docs/auth-md), [MIT reference pinned b53c9edf](https://github.com/workos/auth.md/tree/b53c9edfbfeea679b617727ebca9ba436bade794), [Neon example](https://workos.com/blog/neon-claimable-postgres-auth-md-case-study), repository AGENTS and current auth. Reference is an Express/in-memory demonstration, not production code to copy unchanged.
