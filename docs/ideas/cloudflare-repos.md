# Cloudflare repos worth revisiting

Reviewed 6 Oct 2026 from the READMEs only (nothing was installed or run). Ranked by when to act.

## Do next: `cloudflare/workers-sdk`
Wrangler is already in use. The gap is testing the scheduled handler: S00's cron has only been verified by waiting for real runs (the 18:01 UTC run hit a transient HN timeout).
- Add `@cloudflare/vitest-pool-workers` (Miniflare) and test `worker-entry.mjs`: scheduled handler calls the tick route with the bearer secret, and handles a non-2xx response.
- Keep it secret-free so it can run in the existing "Cloudflare Worker bundle (no secrets)" CI job.

## Next slice candidate: Vantage as an MCP server (`cloudflare/agents`)
Let a customer's own Claude or ChatGPT ask "what's in my queue today?" and read an opportunity with its evidence.
- Read-only tools first: list queue, get opportunity, list sources and coverage. No tool may post, send or draft-and-send to a third-party platform.
- Auth per workspace; reuse `authorizeWorkspace`. Rate limit with the existing Rate Limiting binding.
- Cheap distribution channel for a budget launch.
- Needs an ADR first: Durable Objects keep their own storage, so decide what stays in Neon (everything durable) versus agent state (ephemeral session only).

## Later: per-workspace chat agent (`cloudflare/agents`)
The SEO/AEO chat interface: scheduled scans, persistent conversation, human approval before any draft is shown as ready.
- Revisit after S21 (Workflows) so scans and approvals are not built twice.
- Cost check before committing: Durable Object duration and SQLite storage per workspace.

## Only if a source needs it: `cloudflare/puppeteer`
`lib/browser/run.ts` uses the quick actions (markdown, json, screenshot, links, crawl). Puppeteer gives a scripted session (click, paginate, wait).
- Use it only for a public page that quick actions cannot read.
- Standing rule unchanged: Browser Run is never used for Reddit, LinkedIn, Facebook, Instagram or X.
- Create the browser and any `outboundByHost` fetcher in the same invocation.

## Optional tooling: `cloudflare/mcp-server-cloudflare`
The Observability server could read staging logs, which agents cannot do today. The Browser Run server is handy for quick page checks.
- Needs a Cloudflare API token. Create a fresh, narrowly scoped token and store it in the MCP client's secret store. Never paste tokens into chat or commit them.

## Inspiration only: `cloudflare/cloudflare-os`
Early access ("very capable, but still has many rough edges"), a product rather than a library, and aimed at customers generating their own apps ("Gadgets"). Not a fit.
- Borrow the Gatekeeper idea: outside access goes through capability-scoped, human-approved calls. This matches Vantage's rule that it never writes to third-party platforms.
- Possible far-future feature: customer-built dashboards over their own opportunity data.
