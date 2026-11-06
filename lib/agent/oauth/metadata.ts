import {
  AGENT_DRAFT_SCOPE,
  AGENT_READ_SCOPE,
  AGENT_SCOPES,
} from "@/lib/agent/config";

export const AGENT_RESOURCE_NAME = "Vantage";

/** RFC 9728 protected resource metadata. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/`,
    resource_name: AGENT_RESOURCE_NAME,
    resource_documentation: `${origin}/auth.md`,
    // Must match the authorization server's `issuer` exactly (RFC 8414 §3.3).
    authorization_servers: [origin],
    scopes_supported: [...AGENT_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

/**
 * RFC 8414 authorization server metadata. The `agent_auth` block is added by the
 * anonymous-registration slice; until then this advertises the human OAuth flow only.
 */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    resource: `${origin}/`,
    authorization_endpoint: `${origin}/auth-agents`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [...AGENT_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    bearer_methods_supported: ["header"],
  };
}

/**
 * The agent-facing skill document. Written for a machine reader: what the service
 * is, what the scopes allow, what the free tier costs, and how a human claims it.
 */
export function authMarkdown(origin: string): string {
  return `# auth.md — Vantage

Vantage (${origin}) reads Reddit, Hacker News, X, YouTube, Product Hunt,
Substack, GitHub, Stack Overflow, LinkedIn and RSS, scores what it finds, and
puts up to five conversations a day in front of a workspace owner. Each one
comes with the posts behind it and a grounded draft reply.

**Vantage never posts, replies, comments, votes or sends messages for anyone.**
Every credential below is read-and-draft only. A human copies the text and
posts it themselves.

## Connect

This service speaks the Model Context Protocol over Streamable HTTP at
\`${origin}/api/mcp\`.

1. Read \`${origin}/.well-known/oauth-protected-resource\`.
2. Read \`${origin}/.well-known/oauth-authorization-server\`.
3. Register a public client at \`${origin}/oauth/register\` (no client secret).
4. Send the user to \`${origin}/auth-agents\` with \`response_type=code\`,
   \`code_challenge\` and \`code_challenge_method=S256\`.
5. Exchange the code at \`${origin}/oauth/token\` with the matching
   \`code_verifier\`.
6. Call \`${origin}/api/mcp\` with \`Authorization: Bearer <access_token>\`.

Access tokens last one hour. Refresh tokens rotate on every use.

## Scopes

| Scope | Allows |
| --- | --- |
| \`${AGENT_READ_SCOPE}\` | Read the workspace context, today's ranked conversations and their evidence. |
| \`${AGENT_DRAFT_SCOPE}\` | Draft a reply as text. Nothing is saved, sent or posted. |

## Tools

- \`get_workspace_context\` — the product being tracked, its audience, competitors and topics.

More read tools and \`draft_reply\` arrive with the trial slice.

## Free tier

The free plan covers one workspace, up to five ranked conversations a day, and
one scan a day. Paid provider calls are budgeted per workspace and are off by
default, so a fresh workspace may return an empty queue until its first scan
finishes.

## Anonymous registration

Not enabled on this deployment yet. When it ships, an agent will be able to
register without a human, receive a short-lived read-only credential and a
seven-day trial workspace, then hand the human a link and a six-digit code to
claim that workspace onto their own account.

## Rules

- Do not attempt to post, reply, vote or message on a user's behalf. There is no
  endpoint for it and no scope that permits it.
- Do not store or forward another workspace's data. Every response is scoped to
  the workspace the credential was issued for.
- Respect \`429\` responses and the \`Retry-After\` header.
`;
}
