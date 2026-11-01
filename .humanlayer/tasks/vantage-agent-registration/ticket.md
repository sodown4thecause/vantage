# Task input: auth.md agent registration and access

Liam requests a short GitHub issue in sodown4thecause/vantage, labelled
`agent-ready` and `vertical-slice`, then an explicit approval checkpoint before
coding. Implement later as one PR per approved slice, staging only. Read the
linked auth.md specification, WorkOS guide, MIT reference implementation, Neon
case study, AGENTS.md and existing Neon/Better Auth code first.

Keep Neon Auth; no WorkOS AuthKit. Anonymous registration only initially, no
external ID-JAG registration. Deliver remote MCP with PKCE human login, read
conversation/context tools and text-only private reply generation; discovery;
limited anonymous workspace and assertion/token exchange; verified human claim;
RADAR_LIMITER + hard quotas + expiry cron + audit; minimal Claude plugin/Codex
configuration and one-line installation instructions. Never post/reply/DM on
behalf of users. Default-off AGENT_REGISTRATION_ENABLED. No production deploys
or migrations. List all needed variables/secrets; provision none. Explain terms
plainly; stop/report after two repeats of the same error.

Liam additionally identified client zero as contextfor.dev (typed comtextfor.dev;
normalised to repository's established domain and acknowledged in conversation).
He is writing a case study/blog about progress and wants the actual domain used.
This does not lift the explicit staging-only implementation boundary. A custom
staging hostname requires separate owner configuration approval.

This task supersedes the earlier *recommendation* to defer anonymous claiming
for this staging trial only. It does not approve an unlimited anonymous service,
external identity federation, a new harness, production launch or paid trials.
The request to continue useful venue safety/grounding remains recorded; no
application implementation is started while this new plan awaits approval.

Published plan: https://github.com/sodown4thecause/vantage/issues/178 (issue #178); approval is still pending.

## Subsequent approval

On 1 November Liam approved AR00, then instructed: no further task approval
pauses; continue until finished. Work through AR00–AR05 and necessary safety
dependencies with separate commits/PRs. Do not infer permission to configure
secrets, use production data, spend or bypass a genuine staging setup blocker.

## Current checkpoint

AR00 local protocol proof passes. Independent review timed out twice and was
stopped/reported under Liam's explicit rule. Save a draft PR; no AR01–AR05
implementation or merge until a working review path resolves this checkpoint.
This is a review/runtime blocker, not a request for another task approval.
