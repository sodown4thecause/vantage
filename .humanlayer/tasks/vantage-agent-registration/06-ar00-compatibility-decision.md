# AR00 compatibility decision

**1 November 2026 · local protocol proof, not live Neon/client certification.**
Liam authorised proceeding through the planned slices without approval pauses;
configuration/secrets, production and paid-operation boundaries remain intact.

## Decision

Use the official MCP server/client **2.4.0**, `jose` **6.2.14**, existing
Wrangler **4.152.0** and workerd for the proof. The supported baseline is
**2025-11-25 Streamable HTTP, stateless**. The package's exported legacy version
list/default still names 2025; newer documentation alone is not a compatibility
result. Two hand-built 2026 requests returned HTTP 400, so that path was stopped
rather than repeatedly patched. This is not a finding that the SDK cannot serve
2026: its newer APIs/envelopes were not successfully exercised. Do not advertise
2026 support in the product until a separate positive interoperability test.

Keep Neon Auth for human identity and prefer managed Neon OAuth for native
Claude/Codex PKCE login. Vantage owns anonymous auth.md registration/assertions,
claim and immediate application-grant revocation. Publish two *real* issuers in
protected-resource metadata: managed Neon first for normal interactive clients;
Vantage's own issuer for anonymous auth.md. Vantage's authorization metadata
must describe only its own grants, not impersonate Neon's issuer or claim that
managed Neon accepts anonymous/custom JWT-bearer grants.

The official SDK client in the fixture selects the first (Neon-shaped) issuer,
requests its fixed `openid email` scopes, performs PKCE and calls the real local
Worker. It does not send a human code to the anonymous issuer. No refresh grant,
CIMD/DCR onboarding or real consent UI is certified by this pre-registered-public-
client fixture. Existing Neon browser auth remains unchanged.

Neon's fixed identity scopes do not authorise Vantage actions. Check a
workspace/client/user-bound grant on every request, before workspace data or
upstream work. Human Neon JWTs are one hour per current managed-provider docs;
the proposed **15-minute** access lifetime applies to Vantage's anonymous
credentials, not a falsely configurable Neon lifetime. App-grant expiry and
revocation can deny an otherwise-valid Neon token immediately.

Anonymous assertions and bearer access credentials are different secrets. The
later implementation can use opaque, hash-stored 15-minute access tokens;
service-signed assertions are exchanged only at Vantage's token endpoint and
must not be accepted as MCP access tokens. The AR00 anonymous JWT is only a
fixture proving distinct key/issuer/principal handling, not anonymous token
issuance or a chosen storage format. No anonymous signup, claim, database,
application tool or authentication provider is shipped by this spike.

## Evidence and limitations

`test/agent-registration-compat.test.ts` initially passed **17 tests** with the
selected 2025 baseline: real local workerd, official MCP server/client, real
in-memory EdDSA keys, human PKCE against a clearly labelled contract double,
both fixture principals, exact/array audience checks, wrong-branch/shared-key
rejection, expiry/signature/nbf/identity checks, absent/revoked/wrong-client grants,
cross-workspace refusal, browser-origin guard, disabled/production refusal and
stateless legacy handshake. No real user, provider, model or database was called.
The mock's single-use codes test client wire behaviour, not Neon's real
server-side implementation. Source assertions are not substituted for live proof.

Two initial failed test logs are retained: the first also caught fixture SSE
parsing and empty-subject assumptions; the second retained the unsuccessful
newer-protocol attempt. The successful pinned baseline has a separate log.
Repository-wide validation and review results are recorded separately when run.
Installed client versions observed: **Claude Code 2.1.316**, **Codex CLI 0.165.0**.
Version commands only; neither real client has authenticated to staging.

## Configuration decision — provision nothing

`AR00_FIXTURE_CONFIG` is a **local test-only** Worker variable containing public
test keys and synthetic grants. Tests inject it in memory; it is not a requested
staging variable, secret or production configuration.

The proposed two-issuer design needs no WorkOS keys, new OAuth hosting service,
Redis, Durable Object or OAUTH_KV namespace. Cloudflare's OAuth provider remains
an unselected fallback, not a new dependency or an approved infrastructure task.

| Name | Kind/default | Purpose |
| --- | --- | --- |
| AGENT_REGISTRATION_ENABLED | variable; absent/false | Entire new surface disabled unless staging and explicitly enabled |
| AGENT_REGISTRATION_ORIGIN | variable; no inferred default | Exact staging HTTPS origin, canonical own issuer and MCP audience |
| AGENT_ASSERTION_KEY_ID | variable; required for anonymous issuance | Rotation identifier for service assertions |
| AGENT_ASSERTION_SIGNING_KEY | secret; required for anonymous issuance | EdDSA PKCS#8 private key; never configure or generate a real one here |
| AGENT_TRIAL_BUDGET_USD | variable; 0 | Maximum permitted paid trial work per registration |
| AGENT_TRIAL_GLOBAL_BUDGET_USD | variable; 0 | Shared staging trial ceiling, not permission to turn on providers |

Reuse existing VANTAGE_DEPLOY_ENV, exact staging NEON_AUTH_BASE_URL,
NEON_AUTH_COOKIE_SECRET, DATABASE_URL, CRON_SECRET, VISITOR_SALT, RADAR_LIMITER and
approved model/provider configuration. Enabling managed Neon OAuth requires
owner-side staging provider/resource/login/consent configuration. Public-client
registration may be CIMD or explicitly registered CLI callbacks; its client IDs
are configuration, not secrets. Do not create a confidential CLI client secret.
The current 0.7 browser integration's continuation/consent support must be
checked in AR01; no blind SDK migration is authorised by this source-only choice.
If the actual managed provider cannot satisfy the tested contract, stop the
integration and record a design blocker instead of silently building OAuth.

## Later release checks

Real staging needs the owner-provided configuration above; no values were added.
Verify exact branch issuer/JWKS, audiences, actual Neon sign-in and consent,
signed continuation handling, logout/revocation, native client callback/CIMD
behaviour and modern/legacy transport negotiation. Then prove anonymous
registration → access token → authorised real tool → verified human claim → old
credentials invalid/new credentials usable; quotas, cleanup and flag-off too.
Keep private content and credentials out of logs/screenshots/case-study material.
No production activation or claims of completed acquisition before these pass.
