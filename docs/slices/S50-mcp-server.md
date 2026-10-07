# S50 — MCP server on the Worker

**Track:** Ship as a skill (Idea 4) · **Wave:** 4 · **Size:** L · **Owner:** agent · **Depends on:** S21 (and S31 for the brief tool) · **Unblocks:** S51

## Outcome
Any MCP client can call Vantage: anonymously for the public Radar tool (rate-limited), signed in for workspace tools.

## Scope
- `app/api/mcp/route.ts` implementing MCP over Streamable HTTP (JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`); use the official TypeScript MCP SDK or Cloudflare `agents` MCP helpers if they bundle within the size budget; otherwise a small hand-written handler with tests against the spec version in use (check the current MCP spec before coding).
- Tools: `radar_scan(repo_url)` (S21, anonymous, guarded by S06), `get_radar_result(scan_id)`, `list_opportunities(limit)` (auth, Pro), `reply_brief(opportunity_id)` (auth, Pro), `list_packs()` / `apply_pack(slug)` (auth, Pro). Workspace tools check the S05 entitlement (API/MCP is Pro) before dispatch and return `plan_required` on Free. Each tool has a JSON Schema, a clear description, read-only annotations where true, and structured error codes.
- Auth: OAuth or API token (`api_token` table: hashed token, workspace id, scopes, last used, revoked); Settings → API tokens page; tokens shown once. `authorizeWorkspace` only validates Neon Auth sessions, so add a token-aware resolver (`lib/mcp/auth.ts`: hash the bearer token, load the row, reject revoked, return workspace id and scopes) and re-check workspace ownership and plan with it; never call `authorizeWorkspace` for MCP requests. Required scopes per tool, enforced before dispatch: `list_opportunities` needs `opportunities:read`, `reply_brief` needs `briefs:generate`, `list_packs` needs `packs:read`, `apply_pack` needs `packs:apply`; a token missing the scope gets `insufficient_scope`. Tokens default to the read scopes only.
- **Anonymous guard:** MCP clients cannot solve a Turnstile widget, so S06's `x-turnstile-token` check would 403 every anonymous `radar_scan`. Flow: the guard returns `turnstile_required`; the tool maps that to a structured `challenge_required` error carrying `challenge_url` (`/mcp/verify`, a normal page with the Turnstile widget). After the human solves it, the page shows a short-lived (1 hour) signed pass token (HMAC with a key derived from `VISITOR_SALT`, bound to nothing personal) that the user pastes into the client, which sends it as `x-vantage-pass`; S06 `guardPublicRequest` accepts a valid pass in place of `x-turnstile-token` (add that option in `lib/public/guard.ts` with tests; every other S06 check stays on). Cached `get_radar_result` and already-cached scans need no pass because they spend nothing.
- **Decision (owner):** options for anonymous fresh scans over MCP are (a) the pass-token flow above, (b) require a free account API token, or (c) cached results only. Recommendation: (a), because it keeps the "no signup" promise while keeping Turnstile and the daily dollar budget in force. Note S05 reserves API/MCP for Pro, so (b) would need an owner exception for a Free read-only token.
- Limits: anonymous 2 runs/day per visitor hash (matches the competitor-review reference point), signed-in per plan.
- Docs: `docs/mcp.md` with client config snippets for Claude Code, Cursor, Codex.

## Acceptance criteria
- [ ] Protocol tests: initialize handshake, tools/list schema validity, unknown tool, bad args, auth required, rate limit, Free workspace refused with `plan_required`, missing scope refused with `insufficient_scope`, anonymous `radar_scan` without a pass returns `challenge_required` (not a bare 403) and succeeds with a valid pass.
- [ ] Real client check: connect Claude Code to staging `/api/mcp` and run `radar_scan` (record transcript summary in PR).
- [ ] Token revocation works immediately.
- [ ] No tool can write to a third-party platform (S33 guard still passes).
