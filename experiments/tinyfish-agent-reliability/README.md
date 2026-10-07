# TinyFish Agent reliability experiment

A self-contained, repeatable experiment that measures how reliably the TinyFish
Agent (`@tiny-fish/sdk`) can, given a product topic, do three things:

- **A — Subreddit discovery:** find recent subreddit conversations (subreddit,
  thread title, url, posted date, snippet).
- **B — Authority extraction:** surface expert/authoritative advice inside those
  conversations (top comments, upvoted answers, recognised practitioners) and
  draft a short reply in the user's own voice grounded in that advice.
- **C — YouTube discovery:** find relevant YouTube videos and comment threads.

This folder is **outside the product code path**. It does not modify or import
product code, schemas, migrations, or tests. It is additive and safe to delete.

## Why

Before wiring the TinyFish Agent into the Reddit/YouTube paths (see
`docs/slices/S10-tinyfish-reddit-spike.md`, `S11-reddit-shared-sweep.md`,
`S42-paid-sources-on-credits.md`) we want evidence. Two questions matter:

1. Does the agent return **usable, comment-level content**, or just prose?
2. Is its **recall stable** run to run? If a scan finds different threads each
   time, it is not a stable product surface.

The topic is deliberately low-signal — `free AI GTM signal buzz tool` — the same
topic the Grok X experiment uses, so the two experiments are comparable. Weird
phrases surface how much the agent improvises vs. finds real conversations.

## SDK + agent params

- **SDK:** `@tiny-fish/sdk` `^0.7.0` (recorded per run as `sdkVersion`).
- **Agent call:** `client.agent.run(params)` with

  ```
  browser_profile: "lite"
  agent_config: { mode: "strict", max_steps: 40, max_duration_seconds: 180 }
  output_schema: { ... }   // top-level object; results come back as structured JSON
  ```

  These mirror the repo's `runTinyFishStructuredAgent` (`lib/tinyfish/agent.ts`).
  The experiment calls the SDK directly rather than importing product code.
- **Search path (C):** `client.search.query({ query, include_domains })` — free
  per the repo price table (`lib/costs/prices.ts`).

## Cost

The repo prices TinyFish at **$0.016 per agent step** and search/fetch at **$0**
(`lib/costs/prices.ts`, `DEFAULT_PRICES`). Each run records `num_of_steps` and
`estCostUsd = steps × $0.016`. Search-only work records `0` steps.

## Setup

Keys (never commit these). Put them in
`experiments/tinyfish-agent-reliability/.env.local` (git-ignored) or the repo
`.env`:

```
TINY_FISH_API_KEY="..."
```

Verify the file is ignored before trusting it:

```
git check-ignore experiments/tinyfish-agent-reliability/.env.local
```

Scripts load `.env.local` from this folder first, then the repo root; real
process env always wins.

## Protocol

Run each sub-test **twice back-to-back** to measure within-session variance, then
diff:

```
pnpm tinyfish:reddit       # sub-test A  → runs/<ISO>-subreddit.json
pnpm tinyfish:authority    # sub-test B  → runs/<ISO>-authority.json
pnpm tinyfish:youtube      # sub-test C  → runs/<ISO>-youtube.json
```

Or all three in one sweep:

```
pnpm tinyfish:all
```

Then compare the two most recent runs of a sub-test:

```
pnpm tinyfish:diff subreddit
pnpm tinyfish:diff authority
pnpm tinyfish:diff youtube
```

Pass an explicit topic as the first argument to any runner
(`pnpm tinyfish:reddit "some other topic"`); `tinyfish:diff` takes the sub-test
first, then two optional run files.

## How to read results

Each `runs/<ISO>-<subtest>.json` has a stable schema (see `types.ts`):

```
{
  runId, startedAt, subTest, topic, sdkVersion,
  request: { mode, goal, url, browserProfile, agentConfig, outputSchema, searchQueries },
  raw:     { status, runId, result, error, numOfSteps, startedAt, finishedAt, searchHits },
  response:{ subredditThreads[], authorityVoices[], suggestedReply, youtubeVideos[], youtubeComments[], agentSteps, estCostUsd },
  status:  "ok" | "error",
  error
}
```

- **`raw.result`** — what the agent actually returned. Structured JSON when
  `output_schema` was honoured; otherwise a prose/`{ text }` fallback.
- **`response.*`** — normalized rows the product would consume.
- **`status`** — `ok` only when the run reached `COMPLETED` with no error.

`tinyfish:diff <subtest>` output:

- **retained** — results present in both runs (the stable core).
- **new** — the later run found what the earlier missed.
- **gone** — the earlier run found what the later missed.
- **overlap** — `retained / max(earlier, later)`. 100% = identical recall.

Verdict thresholds: `>= 80%` high (stable), `50–80%` medium (noticeable
fluctuation), `< 50%` low (unstable recall).

Identities used for diffing: subreddit → thread url; authority → source url (or
author + advice prefix); youtube → video id.

## Diagnostics

Two read-only probes isolate *why* a sub-test fails. They are not part of the
protocol but are kept because they explain the results:

- `diag-reddit-access.ts [lite|stealth]` — asks the agent to read a known
  subreddit page and report whether Reddit served it or blocked it.
- `diag-search.ts ["query"]` — asks TinyFish **Search** (the free non-browser
  path) for reddit.com and youtube.com results, to compare against the agent.

```
pnpm tinyfish:diag:reddit lite
pnpm tinyfish:diag:reddit stealth
pnpm tinyfish:diag:search
```

## Results (first sweep, 2026-10-07)

Run on `@tiny-fish/sdk` 0.7.0, topic `free AI GTM signal buzz tool`, two live
runs per sub-test. Costs use the repo price ($0.016/agent step; search free).

| Sub-test | Ran? | Structured JSON? | Results/run | Steps | Cost/run | Overlap |
|---|---|---|---|---|---|---|
| A subreddit | yes | yes | **0 threads** | 3–6 | $0.048–0.096 | 0% (both empty) |
| B authority | yes | yes | **0 voices** | 6–12 | $0.096–0.192 | 0% (both empty) |
| C youtube | yes | yes | 18 videos, 0–5 comments | 3–4 | $0.048–0.064 | 77.8% merged; **50% agent-only** |

**Verdicts**

- **A — subreddit discovery: FAIL.** The agent is blocked by Reddit. Three runs
  returned `{"threads": []}`. The agent's own words (sub-test B): *"The Reddit
  search for this topic was blocked by network security."* `diag-reddit-access`
  confirms a direct `r/LocalLLaMA` page is blocked on **both** `lite` and
  `stealth` profiles. The structured-output contract works; the browsing does not.
- **B — authoritative advice: FAIL (as a Reddit reader).** No comment-level
  content, no authors, no upvotes — because the thread pages never loaded. The
  agent still fabricated a 2–3 sentence "reply", but it is grounded in nothing
  (`groundedIn: []`), so it is **not** usable reply material.
- **C — YouTube search: PARTIAL.** The agent reads YouTube and returns real
  videos + comments, but agent-only recall is unstable (50% overlap; comments
  5 → 0). TinyFish **Search** is the reliable part (100% overlap, free).

**Key finding:** TinyFish **Search** finds Reddit threads where the browser
**Agent** is blocked (`diag-search` returned 7 real reddit.com threads, e.g.
`r/Entrepreneur`, `r/artificial`). Prefer Search → Fetch/parse over the browser
agent for Reddit discovery.

**Gotcha:** the TinyFish API rejects `additionalProperties` in `output_schema`
(`output_schema field "additionalProperties" is not supported at #.`). The
schemas here omit it; note `lib/youtube/client.ts`'s `COMMENT_OUTPUT_SCHEMA`
still sets `additionalProperties: false` and may fail the same way.

## Files

- `run-subreddit.ts` (A), `run-authority.ts` (B), `run-youtube.ts` (C)
- `run-all.ts` — combined sweep; `diff-runs.ts` — variance diff
- `diag-reddit-access.ts`, `diag-search.ts` — read-only diagnostics
- `types.ts`, `lib.ts` — shared schema + helpers
- `package.json` — scopes ESM to this folder so tsx loads the SDK's
  `import`-only export (no dependencies)
- `runs/` — generated; one JSON per run, git-ignored
