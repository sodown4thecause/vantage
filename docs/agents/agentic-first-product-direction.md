# Agentic-first Vantage — product direction (7 Nov 2026)

Status: direction doc. It records what Liam said verbatim in spirit, then
turns it into working rules and an acceptance test. The web UI for humans stays
as is; this doc is about making the agent the first-class citizen.

## 1. The shift in one paragraph

Vantage started as an AI-feature website: a web app with AI bolted into pages.
It must become **agentic-first**: the workspace itself is an agent surface. The
owner's coding agent (OpenCode, Claude Code, Codex, Cursor, anything that speaks
MCP or reads agent skills) should be able to create, operate and grow a Vantage
workspace **without ever leaving the terminal**. The web UI is for review and
approval, not as a gate.

## 2. Firecrawl-style programmatic access

Agents interact with Vantage the way Firecrawl-competitors do: one stable
surface, an API key, no browser.

- Auth: workspace-scoped API key (Bearer). No email OTP in the agent path.
  The human mints the first key once (web settings or CLI pairing); from then
  on the agent is autonomous inside its scopes.
- Everything the UI can do must exist as an API route under `app/api/agent/*`
  with the same IDs the UI shows. If a feature exists only in the dashboard,
  it is not done.
- Sandbox + production keys. Agent key scopes are per-capability
  (`scan`, `seo`, `content`, `agent-chat`) with per-scope spend caps mirroring
  the paid-call approval model.

## 3. Three ways in (in priority order)

1. **Agent Skill** (first): publish as `npx skills add sodown4thcause/vantage`.
   The skill teaches any agent (Claude Code, OpenCode, Codex, Cursor, Amp, ...)
   the full surface: sign up, interview, scan, suggestions, drafts, artifacts.
2. **MCP server**: streamable HTTP MCP at `https://mcp.contextfor.dev/mcp`
   (or under the existing domain), key in the Authorization header. Tools map
   1:1 onto the agent API routes. This is what OpenCode configs natively.
3. **CLI (`vantage`)**: thin wrapper over the same routes for agents that don't
   prefer MCP; also the pairing path (`vantage pair` mints a key). Build last.

## 4. Signup without leaving the terminal

Flow for a brand-new workspace from a blank OpenCode session:

1. Agent installs the skill; calls the `vantage.signup` MCP tool or CLI.
2. The tool returns a one-time device-style link; the CLI/MCP tool renders
   it for the human once (key-pairing moment, mirrors GitHub device flow).
3. After pairing, the agent gets a workspace API key and proceeds fully
   headlessly: interview, profile, first scan.
4. Re-pairing/revocation lives in the web UI; the human can kill a key and the
   agent sees the 401 and surfaces it.

## 5. Suggestion buttons (workspaces that wait for you)

Every workspace keeps a **suggestion engine** that emits up to three
contextual suggestion chips (or MCP tool `vantage.suggest`), because many
users don't know what GTM, SEO or GEO mean, and agents need a well-defined
action space instead of guessing:

- Inputs: profile completeness, scan status, credits, recent approvals and
  rejections, calendar (digest/schedule), and blocked items awaiting consent.
- Each chip is an instruction an agent can execute directly (a defined action
  plus its arguments), **and** a rendered button in the web UI that does the
  same action, so humans and agents share one action space.
- Jargon rule: every chip states the tradeoff in plain language. "Run a GEO
  check? This tests whether ChatGPT, Perplexity and Google AI Overviews cite
  your site. Uses DataForSEO (paid; needs your approval)."
- Suggestion quality is a product feature: a wrong suggestion is a bug like a
  wrong ranking is a bug.

## 6. Consent rails (unchanged, restated for agents)

- Vantage drafts; humans post. Agents must never post/comment/DM on someone's
  behalf, no matter which surface they came in through.
- Paid calls still require approval. An agent key can *queue* a paid action;
  the human approves in the web UI or via the agent's own approval tool.
- The digest email remains the human's day report of what the agents did.

## 7. Acceptance test for "agent-native v1"

On a fresh VM with only Node:

1. `npx skills add sodown4thcause/vantage` inside OpenCode.
2. Say "sign up for Vantage and set up my workspace" — the agent completes
   signup with one human pairing step and zero browser navigation.
3. The agent runs the interview, sets a monitoring profile, kicks the first
   scan, reads back suggestions and drafts, and produces a saved artifact.
4. Every step it took is visible in the web UI with the log identity the
   human sees in the daily digest.

If any step needs a human to open a browser beyond the pairing moment, the
surface isn't ready.

## 8. What changes in the backlog

- New workstream "Agent lane": MCP server + agent API routes + skill package
  (Neon Auth/Better Auth key issuance; Polar bindings unchanged).
- Suggestion engine on every workspace surface (one shared engine, three
  chips max, same action space for UI and MCP).
- README+AGENTS.md copy updates: describe Vantage as agent-first from the
  first line (this file; AGENTS.md rewrite lands separately).

Evidence and OpenNext→vinext infrastructure work continues in parallel — see
`.evidence/spike-vinext/` and the vinext migration guide (docs PR the same
day, `vinext-local-wip` branch).
