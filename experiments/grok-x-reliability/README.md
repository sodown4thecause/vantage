# Grok X reliability experiment

A self-contained, repeatable experiment that measures how reliably the latest
Grok (`grok-4.7`) finds X/Twitter conversations about a topic, across repeated
scans over time.

This folder is **outside the product code path**. It does not import app code,
touch schemas, migrations, or tests. It is additive and safe to delete.

## Why

Before wiring Grok `x_search` into the product (see
`docs/slices/S42-paid-sources-on-credits.md`) we want evidence: if we scan the
same topic twice, does Grok return the same posts? If its recall swings run to
run, a "scan" is not a stable product surface.

The topic is deliberately low-signal — `free AI GTM signal buzz tool` — to
stress-test recall. Weird phrases surface how much Grok improvises vs. finds
real conversations.

## What it does

- `run-scan.ts` — one scan. Calls `grok-4.7` with the server-side `x_search`
  tool and writes a deterministic JSON record to `runs/`.
- `diff-runs.ts` — compares the two most recent run files and prints how many
  posts are new, disappeared, and retained, plus an overlap ratio and verdict.
- `types.ts` — the shared run-record schema.

## Execution path

Preference order:

1. **Vercel AI Gateway** (OpenAI-compatible Responses API) at
   `https://ai-gateway.vercel.sh/v1/responses` with model `xai/grok-4.7`.
   If the gateway rejects that id, we try `grok-4.7`.
2. **xAI direct** at `https://api.x.ai/v1/responses` with model `grok-4.7`,
   only if the gateway is unavailable.

The scan logs which endpoint + model id actually succeeded.

## Setup

Keys (never commit these):

- `AI_GATEWAY_API_KEY` — preferred.
- `XAI_API_KEY` — fallback.

Put them in either the repo `.env`, or a local
`experiments/grok-x-reliability/.env.local` (git-ignored). Example:

```
AI_GATEWAY_API_KEY="..."
XAI_API_KEY="..."
```

Optional overrides:

- `AI_GATEWAY_BASE_URL` (default `https://ai-gateway.vercel.sh/v1`)
- `XAI_BASE_URL` (default `https://api.x.ai/v1`)

## Protocol

1. **Baseline scan** — run once now:

   ```
   pnpm grok:scan
   ```

   (or `pnpm grok:scan "some other topic"`)

   This writes a file to `runs/` and prints a human summary.

2. **Immediate back-to-back scan** — run again right away to measure
   within-session variance (how much recall fluctuates minutes apart):

   ```
   pnpm grok:scan
   pnpm grok:diff
   ```

3. **The 4-hour re-scan** — the point of the experiment. Wait at least
   **4 hours**, then run the scan again and diff it against the most recent
   run:

   ```
   pnpm grok:scan
   pnpm grok:diff
   ```

   `grok:diff` compares the two latest run files, so no arguments are needed.
   Record the overlap ratio from each diff to see how recall drifts over time.

   To compare specific files instead of the two latest:

   ```
   pnpm tsx experiments/grok-x-reliability/diff-runs.ts runs/<earlier>.json runs/<later>.json
   ```

## How to read results

Each `runs/<ISO-timestamp>.json` has a stable schema:

```
{
  runId, startedAt, topic, model, endpoint,
  request: { endpoint, model, topic, fromDate, body },
  response: { text, citations[], posts[], usage, costUsd },
  status: "ok" | "error",
  error
}
```

- `posts[]` — cited X posts: `{ id, url, author, text, postedAt }`.
- `endpoint` — `ai-gateway` or `xai-direct`; which path worked.
- `status` — `ok` or `error`; on error, `error` holds the message and the
  request body is preserved for debugging.

`grok:diff` output:

- **retained** — posts found in both runs (the stable core).
- **new** — posts the later run found that the earlier missed.
- **gone** — posts the earlier run found that the later missed.
- **overlap** — `retained / max(earlier, later)`. 100% = identical recall.

Verdict thresholds: `>= 80%` high (stable), `50–80%` medium (noticeable
fluctuation), `< 50%` low (unstable recall).

Note: posts are matched by thread URL (falling back to id). Different posts
from the same thread are treated as the same thread.

## Files

- `run-scan.ts`, `diff-runs.ts`, `types.ts`
- `runs/` — generated; contains one JSON per scan. Safe to commit a curated
  subset if you want a record, but by default treat as throwaway output.
