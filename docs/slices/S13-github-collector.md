# S13 — GitHub issues and discussions collector + competitor repo watch

**Track:** Sources (Ideas 1, 2) · **Wave:** 2 · **Size:** M · **Owner:** agent + human (H5) · **Depends on:** S03, S04 · **Unblocks:** S21

## Outcome
Vantage reads public GitHub issues/discussions for (a) the user's own repo and topics and (b) competitors' repos, to find the warmest leads ("is this still maintained?", "any alternative?", license changes).

## Scope
- **Source type:** add `github` per README section 2 item 8 (enum value migration, union, registry, scan allow-list, guard, add-source UI).
- `lib/github/client.ts`: REST (`GET /search/issues`, `GET /repos/{o}/{r}/issues`, GraphQL for discussions) with `GITHUB_TOKEN`, ETag conditional requests, rate-limit header handling (back off at `x-ratelimit-remaining` < 10), every call through `withCost` (cost 0) and the `github` switch.
- `lib/collectors/github.ts` implementing `Collector`: config `{repos: string[], queries: string[], includeDiscussions: boolean}`; normalizes to `NewDocument` (`platform: "github"` added to `sourcePlatformValues`), `metadata.kind = issue|discussion|comment`.
- **Competitor watch:** `monitoring_profile.competitors` is a free-form `string[]` of names, so only entries that match a strict repo form are treated as GitHub repos: `owner/repo` or `https://github.com/owner/repo` (optionally with `.git`, a trailing slash or `/issues`), parsed by a pure `parseGithubRepoRef()` in `lib/github/client.ts` (owner `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`, repo `^[A-Za-z0-9._-]{1,100}$`; anything else, including bare product names, is ignored, never guessed or searched for). Each parsed ref is verified with `GET /repos/{o}/{r}` and kept only if public. Verified repos become `github` sources automatically (within plan source limits) with query patterns (`"still maintained"`, `"alternative to"`, `"license"`, `"moving away"`); signals feed `lib/pipeline/intent-ladder.ts` (add rungs for churn/switching language, keep ladder pure and unit-tested).
- Fixture file `test/fixtures/github.json`.

## Acceptance criteria
- [ ] `parseGithubRepoRef` tests: accepted forms, rejected names (`Acme`, `acme corp`, URLs on other hosts, path traversal, over-long segments), and a private/404 repo is not added.
- [ ] Collector tests with fixtures: issues, discussions, pagination, 304 not modified, rate limit, token missing (`access_pending`, no crash).
- [ ] Intent ladder tests for the new phrases (true and false positives).
- [ ] Source add UI works; scan picks it up; coverage label correct.
- [ ] No private-repo access: token is read-only public; reject non-public repos.

## Out of scope
Posting comments (never), GitHub App installs, webhooks.
