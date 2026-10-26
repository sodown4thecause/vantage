# Reddit scan failure evidence

Investigated 26 October 2026 on `codex/ai-workspace`, based on `dd30de3`.

## Finding and evidence limits

Two data-retention defects were independently reproduced against the actual Reddit client/collector with synthetic provider responses. They are confirmed local bugs, not proven explanations of the reported live incident. No historical scan/job records, authenticated staging run, live provider response, live result count or provider receipt was available. No provider calls or spend were made.

The shell has no `DATABASE_URL`, `FIRECRAWL_API_KEY`, `LINKUP_API_KEY`, `TINYFISH_API_KEY`, `SCAVIO_API_KEY` or `CLOUDFLARE_API_TOKEN`; the worktree contains only `.env.example`. Only variable presence was checked. No secrets or customer content were read or logged. Real workspace/source/scan IDs are unavailable; IDs in tests are synthetic.

## Boundary trace

1. Manual source scans enter `lib/sources/actions.ts:99`, authorise the workspace before collection, and call `runCollector` under the existing lease. `lib/collectors/run.ts` selects the source by source/workspace ID before provider IO.
2. First scan dispatch uses `lib/activation/dispatch.ts`; `lib/activation/run.ts:67` scopes collection with `withFirstScanBudget`. The shared paid-call implementation reserves provider budget and the first-scan allowance before upstream work. Those gates were not modified.
3. `redditCollector.run` normalises up to three queries, shares the limit and calls `fetchRedditPostsWithMeta` with workspace attribution and cancellation.
4. The client tries configured Firecrawl/Linkup discovery lanes, then TinyFish Search+Fetch, TinyFish Agent and Scavio. Canonical Reddit `/comments/` validation filters discovery output. No HN substitution was added.
5. Optional hydration is followed by bot filtering and document mapping. Documents retain preview/full-thread provenance. The collector runner persists documents before updating the source cursor and health receipt; downstream queue/build processing is unchanged.

## Reproduction A: a deferred topic clears the stored cursor

Synthetic first query returns one real-provider-labelled preview; the second throws `First scan allowance exhausted`. The collector correctly returns one document and `partial: true`, but previously returned `nextState.cursor: null` for both a stored cursor and an omitted cursor. Per `CollectorResult` and the runner, null clears stored state; undefined preserves it. The cursor assignment from the first successful topic escaped into the partial result even though later coverage remained unprocessed.

Correction: when topic coverage is partial, return `ctx.cursor` exactly, including undefined. Completed searches keep their existing cursor behaviour. First-query failure still rejects; successful empty searches remain empty; cancellation still rejects.

RED: `pnpm exec vitest run test/reddit-partial-search.test.ts` — exit 1, 2 failed / 3 passed. Both failures were the intended cursor assertions: expected `unprocessed-cursor` or undefined, received null. The initial one-cursor reproduction also failed before the fix (1 failed / 3 passed).

## Reproduction B: optional TinyFish page fetch discards discovery

Synthetic TinyFish Search returns a canonical Reddit thread with a literal excerpt. The subsequent page fetch rejects with a synthetic 503. Previously `freePosts` rejected and `fetchFromProviders` tried the TinyFish Agent; with no successful fallback the entire call threw `Reddit provider unavailable`, discarding the already discovered preview.

Correction: ordinary page-fetch failures retain the validated search previews. The existing `terminalFailure` helper still propagates the same AbortError or PaidCallDeniedError object; these are not converted into success or fallback spend. Retained snippets remain `contentKind: preview`, never `thread` or `page_excerpt`.

RED: `pnpm exec vitest run test/reddit-firecrawl-lane.test.ts -t 'retains discovered TinyFish previews'` — exit 1, 1 failed / 32 skipped; the real client threw `Reddit provider unavailable` at the final provider boundary. A second run including `TinyFish page-fetch` confirmed the new retention assertion failed while cancellation and paid-denial cases passed (1 failed / 2 passed / 32 skipped).

## Verification

Commands used `pnpm.cmd` on native Windows. Portable equivalents:

```text
pnpm exec vitest run test/reddit-partial-search.test.ts test/reddit-firecrawl-lane.test.ts test/reddit-pipeline.test.ts test/scavio-social-collectors.test.ts test/collector-runner.test.ts test/scan-source-action.test.ts test/first-scan-budget.test.ts test/first-scan-run.test.ts test/first-scan-dispatch.test.ts
```

GREEN: exit 0, 121 tests passed across 9 files. The cursor-only intermediate run passed 105 tests across 6 files. Focused ESLint for both implementation files and both changed test files passed with no output. `git diff --check` passed.

## Remaining acceptance and health handoff

- Actual staging Reddit scan: ACCESS_PENDING. Needed: an authorised staging session with a workspace/source and approved provider access/budget. Record dispatch/run IDs, selected provider, discovery count, hydration count, persisted result count, partial state and settled cost. No such values were invented here. Live acceptance remains unmet.
- Task 2 must expose the TinyFish hydration failure as a bounded stage/status in its additive health contract. The current public meta contract only carries `provider`; the catch in `freePosts` now preserves previews but cannot separately report why hydration failed. A dated preview can still yield a healthy source receipt. Preview provenance alone must not be interpreted as verified full-thread success.
- No public API, schema, package, lockfile, UI, policy, budget, URL-safety, deployment or production resource change was made. Historical incident attribution, full-suite/build checks and independent review remain coordinator-owned gates.
