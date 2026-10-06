# S50 — MCP server on the Worker

**Track:** Ship as a skill (Idea 4) · **Wave:** 4 · **Size:** L · **Owner:** agent · **Depends on:** S21 (and S31 for the brief tool) · **Unblocks:** S51

## Outcome
Any MCP client can call Vantage: anonymously for the public Radar tool (rate-limited), signed in for workspace tools.

## Scope
- `app/api/mcp/route.ts` implementing MCP over Streamable HTTP (JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`); use the official TypeScript MCP SDK or Cloudflare `agents` MCP helpers if they bundle within the size budget; otherwise a small hand-written handler with tests against the spec version in use (check the current MCP spec before coding).
- Tools: `radar_scan(repo_url)` (S21, anonymous, guarded by S06), `get_radar_result(scan_id)`, `list_opportunities(limit)` (auth), `reply_brief(opportunity_id)` (auth, Pro), `list_packs()` / `apply_pack(slug)` (auth). Each tool has a JSON Schema, a clear description, read-only annotations where true, and structured error codes.
- Auth: OAuth or API token (`api_token` table: hashed token, workspace id, scopes, last used, revoked); Settings → API tokens page; tokens shown once.
- Limits: anonymous 2 runs/day per visitor hash (matches the competitor-review reference point), signed-in per plan.
- Docs: `docs/mcp.md` with client config snippets for Claude Code, Cursor, Codex.

## Acceptance criteria
- [ ] Protocol tests: initialize handshake, tools/list schema validity, unknown tool, bad args, auth required, rate limit.
- [ ] Real client check: connect Claude Code to staging `/api/mcp` and run `radar_scan` (record transcript summary in PR).
- [ ] Token revocation works immediately.
- [ ] No tool can write to a third-party platform (S33 guard still passes).
