# Staging API inventory — 7 October 2026

Worker: vantage-staging, Cloudflare account eb1a55a5673488809e31067f32290af1.
Code inspected: PR #34 branch at d74bdfcfb327b31a6a68d62fe25b5c1054af34d9. This is not proof of the currently deployed Worker source version.

The requested `wrangler secret list --name vantage-staging --env staging` failed because Wrangler is unauthenticated. The authenticated Cloudflare dashboard runtime secret table was inspected instead. It contains exactly:
- CRON_SECRET
- DATABASE_URL
- NEON_AUTH_BASE_URL
- NEON_AUTH_COOKIE_SECRET

No secret values were revealed or changed. Dashboard presence verifies configuration only, not provider authentication or entitlement.

| Integration | Staging secret | Implementation at pinned commit | Recommendation |
| --- | --- | --- | --- |
| TinyFish | TINYFISH_API_KEY absent | Search, Fetch, Agent paths for YouTube and Product Hunt | Add if using these existing paths; validate a real request before enabling collectors |
| Scavio | SCAVIO_API_KEY absent | Reddit search, X search, YouTube comments | Required by current Reddit/X implementation; optional after those paths are replaced and verified |
| ScrapeCreators | SCRAPECREATORS_API_KEY absent | Planned and price-listed; no runtime client/key use found | Add when its collector integration is implemented; adding a key alone has no effect |
| Vercel AI Gateway | AI_GATEWAY_API_KEY absent | Documented key; no runtime use found | Implement Grok with X Search enabled before relying on it for current X information |
| Official X API | No configured secret or adapter found | Not implemented | Proposed X_BEARER_TOKEN for application-authenticated read requests; user-specific OAuth needs separate design |
| YouTube Data API | YOUTUBE_API_KEY absent | Existing fallback after Scavio/TinyFish | Optional alternate path for known video IDs |
| Product Hunt API | PH_DEV_TOKEN absent | Existing fallback after TinyFish | Optional alternative to TinyFish for Product Hunt |

Grok model invocation alone does not establish fresh X grounding. Explicitly enable X Search, retain source citations, and verify tool execution. Official references: https://docs.x.ai/developers/tools/x-search and https://vercel.com/ai-gateway/models/grok-4.5 . The user has not specified the Gateway model ID, and the newest supported model was not determined in this audit.

Scavio can become unnecessary if X uses Grok/official X, Reddit has an implemented replacement, and YouTube uses TinyFish or the existing official API path. ScrapeCreators documents broader platform coverage, including Reddit and YouTube, but replacement behavior has not been validated here: https://docs.scrapecreators.com/integrations/agent-skill/ .

Execution gate: lib/collectors/run.ts blocks every collector other than HN/RSS/Substack when NODE_ENV=production. Staging bundles built in production mode are subject to that guard too. Keys alone do not enable paid collection. Source switches, budgets, and live provider verification must be handled in the implementation.

Core public-route prerequisites TURNSTILE_SECRET_KEY and VISITOR_SALT are also absent from the inspected runtime table. Their intended branch implementation documents fail-closed behavior and production salt requirements.

No paid requests were sent and no configuration was modified by this audit.
