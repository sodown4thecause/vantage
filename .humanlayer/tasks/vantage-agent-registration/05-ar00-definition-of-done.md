# AR00: approved compatibility proof

Liam approved AR00 and then authorised continuing through the task without
further approval pauses. This authorises AR00–AR05 and their necessary safety
dependencies, not production deployment, secrets provisioning or paid calls.
Commit/PR each slice separately; do not merge/deploy simply to bypass a missing
staging credential, account or review requirement.

Definition of done, before application code:
1. The official pinned MCP server answers a fixture-only tool inside local
   workerd using real signed test tokens; wrong issuer/audience/expiry/signature,
   cross-workspace access and missing/revoked grants are denied.
2. The official pinned MCP client completes discovery and PKCE against a mock
   Neon-compatible authorization server, then calls the local Worker. Record
   exactly which protocol/client paths were exercised, not a real Neon claim.
3. The spike has no application routes, database writes, provider calls, actual
   credentials or deployable production configuration. Existing Neon auth and
   migration 0035 are unchanged.
4. A decision record identifies issuer routing, token/scope differences, exact
   configuration and remaining real-Neon/Claude/Codex staging checks. If mocked
   compatibility fails, report the blocking scenario rather than claim success.

Proof scope: local protocol/Worker fixture tests, repository checks and source
review. The backend dataflow skill's real-database journey is not applicable to
this isolated protocol proof: no application dataflow or query is introduced.
Real staging, browser UX and customer registration evidence belongs to later
slices and cannot be inferred from this fixture.
