# Vantage for Claude Code

Connects Claude Code to Vantage's MCP server: today's ranked conversations, the
posts behind them, and a grounded draft reply. Read and draft only. Vantage
never posts, replies or messages anyone.

## Install

```
/plugin marketplace add sodown4thecause/vantage
/plugin install vantage@vantage
```

**The endpoint is staging-only for now.** The manifest points at
`https://contextfor.dev/api/mcp`, where agent access is switched off, so a tool
call there returns 404 until it is enabled. Point `mcpServers.vantage.url` at a
staging origin to try it today (see Staging below).

Once the endpoint is live, Claude Code opens the consent screen at
`/auth-agents` the first time it calls a tool. Sign in, approve, and the tools
appear.

## Tools

| Tool | Scope | What it does |
| --- | --- | --- |
| `get_workspace_context` | `vantage.read` | The product, audience, competitors and topics being tracked. |
| `list_todays_conversations` | `vantage.read` | Up to five conversations worth joining today, best first. |
| `get_conversation` | `vantage.read` | One conversation with the original posts behind it. |
| `draft_reply` | `vantage.draft` | A grounded reply as text. Nothing is saved, sent or posted. |

## Staging

The endpoint is enabled on staging only for now. To point the plugin at a
staging deployment, change `mcpServers.vantage.url` in
`.claude-plugin/plugin.json` to that origin plus `/api/mcp`.
