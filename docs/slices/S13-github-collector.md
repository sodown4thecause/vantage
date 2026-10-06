# S13 — GitHub issues and discussions collector + competitor repo watch

**Track:** Sources (Ideas 1, 2) · **Wave:** 2 · **Size:** M · **Owner:** agent + human (H5) · **Depends on:** S03, S04 · **Unblocks:** S21

## Outcome
Vantage reads public GitHub issues/discussions for (a) the user's own repo and topics and (b) competitors' repos, to find the warmest leads ("is this still maintained?", "any alternative?", license changes).

## Scope
- **Source type:** add `github` per README section 2 item 8 (enum value migration, union, registry, scan allow-list, guard, add-source UI).
- `lib/github/client.ts`: REST (`GET /search/issues`, `GET /repos/{o}/{r}/issues`, GraphQL for discussions) with `GITHUB_TOKEN`, ETag conditional requests, rate-limit header handling (back off at `x-ratelimit-remaining` < 10), every call through `withCost` (cost 0) and the `github` switch.
- `lib/collectors/github.ts` implementing `Collector`: config `{repos: string[], queries: string[], includeDiscussions: boolean}`; normalizes to `NewDocument` (`platform: "github"` added to `sourcePlatformValues`), `metadata.kind = issue|discussion|comment`.
- **Competitor watch:** monitoring profile competitors that are GitHub repos become `github` sources automatically with query patterns (`"still maintained"`, `"alternative to"`, `"license"`, `"moving away"`); signals feed `lib/pipeline/intent-ladder.ts` (add rungs for churn/switching language, keep ladder pure and unit-tested).
- Fixture file `test/fixtures/github.json`.

## Acceptance criteria
- [ ] Collector tests with fixtures: issues, discussions, pagination, 304 not modified, rate limit, token missing (`access_pending`, no crash).
- [ ] Intent ladder tests for the new phrases (true and false positives).
- [ ] Source add UI works; scan picks it up; coverage label correct.
- [ ] No private-repo access: token is read-only public; reject non-public repos.

## Out of scope
Posting comments (never), GitHub App installs, webhooks.
