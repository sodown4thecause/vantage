# S10 — TinyFish-on-Reddit spike

**Track:** Reddit · **Wave:** 1 · **Size:** S · **Owner:** agent + human (H4) · **Depends on:** none · **Unblocks:** S11, S12

## Question
Does TinyFish **Fetch** return usable content for public Reddit pages (subreddit listings, post pages), and does TinyFish **Search** return Reddit posts for keyword queries? The review flagged this as untested; the answer decides whether the shared sweep costs about $0 or about $23/month.

## Scope
- Script `scripts/spikes/tinyfish-reddit.ts` (run with `pnpm tsx`, reads `TINYFISH_API_KEY` from env; never prints it). Use `lib/tinyfish/search-fetch.ts` (`tinyFishSearch`, `tinyFishFetchMarkdown`).
- Test 20 subreddit listing URLs (`https://www.reddit.com/r/<name>/new/`) and 20 post URLs, plus 20 keyword searches (`site:reddit.com <keyword>`). Record per call: success, content length, whether posts/authors/timestamps/links are extractable, latency, cost reported, rate-limit or block signals.
- Output `docs/spikes/tinyfish-reddit-2026-10.md` with the table, a verdict (Fetch works / partly / no), measured cost per sweep of 100 subreddits, and the recommended chain order for S11.
- Do **not** store scraped content in the repo; keep only aggregate stats and 2 short redacted examples.
- Respect robots/terms: no more than 1 request/second; stop on any block signal and report it.

## Acceptance criteria
- [ ] Report committed with the verdict and numbers.
- [ ] Recommended order and per-sweep cost estimate written; S11's "Decision" section updated accordingly.
- [ ] Script reads secrets only from env; no secret in output.

## Out of scope
Building the sweep (S11).
