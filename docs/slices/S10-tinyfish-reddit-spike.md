# S10 — TinyFish-on-Reddit spike

**Track:** Reddit · **Wave:** 1 · **Size:** S · **Owner:** agent + human (H4) · **Depends on:** none · **Unblocks:** S11, S12 · **Status:** not started · **Do this next** (before 31 Oct 2026)

## Why this is next (20 Oct 2026)
Reddit stops accepting new public API requests on 31 Oct, and Reddit RSS ends 13 Nov. Today `reddit` is a keyed source: `MANUAL_KEYED_SOURCE_TYPES` in `lib/cron/scan.ts` runs it on an owner's "Scan now" only, never on the hourly production cron. S11 cannot choose a chain or a cost until this spike measures TinyFish Fetch and Search against public Reddit pages. Needs `TINYFISH_API_KEY` (human gate H4); the script must read it from the environment and never print it.

## Question
Does TinyFish **Fetch** return usable content for public Reddit pages (subreddit listings, post pages), and does TinyFish **Search** return Reddit posts for keyword queries? The review flagged this as untested; the answer decides whether the shared sweep costs about $0 or about $23/month.

## Scope
- Script `scripts/spikes/tinyfish-reddit.ts` (run with `pnpm tsx`, reads `TINYFISH_API_KEY` from env; never prints it). Use `lib/tinyfish/search-fetch.ts` (`tinyFishSearch`, `tinyFishFetchMarkdown`) for content results only. Those helpers drop response metadata and `withCost` records the configured unit price (currently $0 for search and fetch in `lib/costs/prices.ts`), so they cannot show real cost: for the cost figure, call the TinyFish client directly in the script (`client.search.query`, `client.fetch.getContents`) and log any usage/credit fields in the raw response, and also record the TinyFish dashboard credit balance before and after the run (a human step if the API exposes no balance). If neither source shows usage, report cost as "unmeasured" and do not use $0 for S11's cost decision.
- Test 20 subreddit listing URLs (`https://www.reddit.com/r/<name>/new/`) and 20 post URLs, plus 20 keyword searches (`site:reddit.com <keyword>`). Fetch Reddit URLs one at a time (one URL per `getContents` call; `tinyFishFetchMarkdown` batches up to 10 and adds no delay, so do not use it for Reddit URLs) with at least one second between calls. Record per call: success, content length, whether posts/authors/timestamps/links are extractable, latency, cost actually reported by the provider (or "none reported"), rate-limit or block signals.
- Output `docs/spikes/tinyfish-reddit-2026-10.md` with the table, a verdict (Fetch works / partly / no), measured cost per sweep of 100 subreddits, and the recommended chain order for S11.
- Do **not** store scraped content in the repo; keep only aggregate stats and 2 short redacted examples.
- Respect robots/terms: no more than 1 request/second; stop on any block signal and report it.

## Acceptance criteria
- [ ] Report committed with the verdict and numbers.
- [ ] Recommended order and per-sweep cost estimate written; S11's "Decision" section updated accordingly.
- [ ] Script reads secrets only from env; no secret in output.

## Out of scope
Building the sweep (S11). Putting `reddit` on the schedule (that is S11, and it stays off `SCHEDULED_SOURCE_TYPES` until the chain and its budget exist).
