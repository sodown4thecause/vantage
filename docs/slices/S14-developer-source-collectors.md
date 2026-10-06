# S14 — Developer source collectors

**Track:** Sources (Idea 1) · **Wave:** 2 · **Size:** L (five independent sub-tasks, can be split across agents) · **Depends on:** S03, S04 · **Unblocks:** S21

## Outcome
Vantage covers the developer communities Reddit-only tools miss.

## Sub-tasks (each is its own PR; follow README section 2 item 8 for source types)
| ID | Source | Access | Notes |
|---|---|---|---|
| S14a | Stack Overflow | Stack Exchange API (key optional, quota applies) | questions by tag/keyword; respect `backoff` field |
| S14b | DEV.to | Forem API `GET /api/articles`, `GET /api/comments` | public, no key for reads |
| S14c | Lobsters | JSON feeds (`/newest.json`, `/t/<tag>.json`) | polite polling, conditional GET |
| S14d | Bluesky | public AppView search (`app.bsky.feed.searchPosts`) | no auth for public search; verify endpoint access when building |
| S14e | Discourse | public `/latest.json`, `/search.json` per configured forum | config `{baseUrl}`; SSRF guard via `isPublicHttpUrl` |

## Per sub-task scope
Collector in `lib/collectors/<name>.ts` + client in `lib/<name>/client.ts` + fixture in `test/fixtures/` + tests (success, empty, pagination, 304/ETag where supported, rate-limit, provider error). Normalization to `NewDocument` with stable `urlCanonical` and `contentHash`. All calls via `withCost` (cost 0) and `getSourceSwitch(<type>)`. Add to registry, `lib/cron/scan.ts`, add-source UI, and relax the production guard for the type. 2 to 4 days each.

## Acceptance criteria (each sub-task)
- [ ] Documents appear in Neon for a staging workspace using the new source (screenshot/SQL excerpt in PR).
- [ ] Source health labels correct on failure.
- [ ] Terms/rate-limit notes added to `docs/sources/<name>.md` (link to the provider's own API terms).

## Out of scope
Anything that requires login or scraping behind auth.
