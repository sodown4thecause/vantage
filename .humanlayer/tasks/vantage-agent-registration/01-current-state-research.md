# Current state: agent registration and client zero

**1 November 2026. Research only; no implementation or integration certification.**

## Repository and remote baseline

Current checkout began at c5cb8bb, the production-readiness branch. Remote main
was fetched successfully and resolves to 84fe2c9. Its latest migration and journal
entry are 0035_daily_impossible_man / index 35. The inspected browser auth files
are unchanged between this checkout and main. The new planning branch is
`docs/agent-registration-plan`; implementation must use fresh branches from
then-current main and inspect dependencies on unmerged readiness changes.

- `app/providers.tsx` wraps NeonAuthUIProvider and enables email OTP. It is not
  an anonymous agent identity or a bearer-token resource server.
- `lib/auth/server.ts` lazily constructs managed Neon Auth; `lib/auth/workspace.ts`
  derives the signed-in user from the browser session and checks workspace owner.
  It does not accept an agent-provided owner ID as authorisation.
- `lib/db/schema.ts` allows a nullable workspace owner, but that alone is not a
  safe trial principal, grant, expiration policy or claim implementation.
- `lib/db/actions.ts` creates workspaces only for signed-in users, checks project
  limits and can send a welcome email. Wrapping it as anonymous registration
  would not preserve its assumptions or prevent unintended effects.
- `lib/public/guard.ts` requires Turnstile, uses an optional RADAR_LIMITER and
  stores daily hashed-IP counters. The existing guard is not an agent-specific,
  mandatory-limiter registration/claim policy.
- `lib/plans/types.ts` defines free and pro plans; free currently has one project
  and zero reply_briefs. Trial allowances and post-claim entitlements are not
  interchangeable, and claim must not silently manufacture a paid plan.
- `lib/drafting/contribution.ts` has evidence validation, venue policy, abstention
  and paid-call reservation seams. Some venues return research briefs rather
  than AI-written replies. Broad Content coverage defects remain in the earlier
  readiness audit; an MCP adapter must not create another bypass.
- `worker-entry.mjs` uses the SCAN-bound Workflow path when available and bypasses
  `/api/cron/tick`; cleanup added solely to tick would miss that configuration.
- `lib/workspace/delete.ts` documents best-effort vector deletion and currently
  cannot remove screenshot R2 keys. Complete anonymous expiry cannot be claimed
  merely by invoking that helper.

## Protocol and reference source observations

Read the requested specification, official WorkOS guide, Neon case study, MIT
license, reference service guide and actual registration/claim/token/store/
verification source at WorkOS commit
`b53c9edfbfeea679b617727ebca9ba436bade794`. Sources were fetched as text only;
no upstream install, application launch or source adoption occurred.

Anonymous registration returns a service-signed identity_assertion and a claim
token. JWT-bearer exchange obtains a bearer access token; the anonymous flow
renews through assertions, not OAuth refresh tokens. Claim is initiated with
the claim token and intended email, followed by a human sign-in/code-confirmation
and bounded polling at the token endpoint. Human PKCE connections are a different
flow: an install command or native MCP login is not proof a client implements
the anonymous auth.md onboarding protocol.

The reference uses Express and process-local Maps, mock login and a demo polling
handler that explicitly omits slow_down enforcement. It is evidence of wire
shapes, not a production-ready Workers/SQL implementation. Its prose has nuances
around assertion reuse after claim; Vantage's stricter credential-generation
revocation requires explicit tests, not copying the demo's scope selection.
No external identity trust list, SET receiver or ID-JAG acceptance is needed for
this anonymous-only scope. The returned *service* assertion must not be confused
with accepting `type: identity_assertion` from an external provider.

Current managed Neon OAuth documentation lists authorization_code and
refresh_token grants, fixed identity scopes, and branch-specific issuer checks.
It does not expose the auth.md anonymous/claim grants. It may still provide human
PKCE delegation while Vantage implements anonymous grants separately; exact
issuer/discovery/client interoperability needs the proposed AR00 proof.

The official MCP v2 Fetch-native handler supports Workers but explicitly does
not validate Host/Origin or automatically authenticate Bearer headers. These
are application responsibilities, alongside workspace grants, quotas and output
boundaries. The Cloudflare OAuth library is a candidate, not a selected new
platform: it needs OAUTH_KV; its experimental ID-JAG mode is not the requested
anonymous protocol, and its documented replay store is eventually consistent.
Neither its extra storage nor managed Neon OAuth configuration is provisioned.

## Acquisition and evidence status

The user confirmed contextfor.dev as client zero and is writing a case study.
This records intent, not completed onboarding, customer results, ownership proof
or permission to enable staging features on production. No numerical conversion
or success thresholds were supplied. Public sources must not receive private
workspace data or case-study screenshots containing credentials.

The documented exe.dev GitHub integration supports `GH_HOST=github.int.exe.xyz`
with the existing off-VM credential. Read access and requested issue creation
worked without a new token, secret or GitHub login. Both requested labels already
exist. Issue #139 covers agent-led product discovery; this task must coordinate
rather than duplicate it. No project-board movement or agent assignment occurred.

No application tests, real OAuth/client runs, account creation, mail delivery,
paid provider calls, migration application or deployments were performed.
Source snapshots and SHA-256 hashes are indexed in `sources.json`.
