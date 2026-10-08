# Semantic scoring

Semantic scoring runs beside the keyword intent ladder. Its values are recorded in
`semantic_shadow` so they can be checked against the keyword rungs before they affect
any lead.

## Modes

Set with `VANTAGE_SEMANTIC_MODE`. Any value other than `shadow` or `on` means `off`.

| Mode | Behaviour |
| --- | --- |
| `off` (default) | `runSemanticStage` returns before any AI or Vectorize call. Nothing is written. |
| `shadow` | Pending profile and document embeddings are indexed, up to 200 documents per build are embedded and scored, and one `semantic_shadow` row per document is written with `mode = 'shadow'`. The keyword pipeline does not read these values. |
| `on` | Same recording as `shadow`, rows written with `mode = 'on'`. Semantic signals also feed scoring (see [On mode](#on-mode)). Enable only after the calibration review in the [rollout rule](#rollout-rule). |

Scoring degrades to keyword-only when the AI or Vectorize binding is missing or a call
fails. Semantic failures never fail a scan.

## Signals and thresholds

`SEMANTIC_THRESHOLDS` in `lib/pipeline/semantic.ts`:

| Constant | Value | Used by |
| --- | --- | --- |
| `anchor` | 0.6 | `semanticRung` is set only when the nearest anchor similarity is at least this value. Below it the rung is null. |
| `fit` | 0.5 | Declared; not applied in code. The fit term in on mode uses the raw semantic fit, not this threshold. |
| `duplicate` | 0.92 | Near-duplicate collapse in `on` mode (`nearDuplicates`). Provisional. |

- `semanticRung`: rung of the nearest anchor (the rung scale is the intent ladder: 0 noise,
  1 awareness, 2 research, 3 comparison, 4 purchase or recommend), or null.
- `semanticFit`: highest cosine between the document and the workspace profile vectors
  (top 3 matches). Recorded even when `semanticRung` is null.
- `anchorSimilarity`: cosine to the nearest anchor.
- `keywordRung`: rung from `classifyIntent`, the deterministic keyword ladder.

## On mode

`on` is the only mode in which semantic signals reach scoring. `shadow` and `off` leave
scoring keyword-only. In `on` mode:

- **Intent.** `classifyIntent(doc, signal)` takes the semantic signal. The result is the
  keyword rung, raised to the semantic rung when that is higher. A semantic match never
  lowers a keyword rung, and without a signal the result is keyword-only.
- **Fit.** `fit = max(tokenFit, semanticFit)`, where `semanticFit` is the highest
  semantic fit across the opportunity's documents (`lib/opportunities/features.ts`).
- **Near-duplicates.** Documents are linked when their cosine is at least `duplicate`
  (0.92), transitively, and the earliest posting becomes the representative. Only the
  representative is scored as an item. The absorbed duplicates are kept as evidence on
  that representative and do not count as separate items. This collapse runs only in
  `on` mode and only when document vectors exist.
- **Grounded drafting.** Draft prompts take the product-material chunks nearest the
  conversation from the `material` vectors (`lib/drafting/ground.ts`). Those chunks
  replace the 800-character profile slice when any are returned. When grounding is
  unavailable it returns null and the slice is used.

Provisional thresholds (`anchor`, `duplicate`) are trusted only after a calibration
review. Run the report, read the disagreements, and adjust `SEMANTIC_THRESHOLDS` if the
review shows a problem. Until that review has been done, treat `on` results as provisional.

## Reading the report

```
DATABASE_URL=... pnpm tsx scripts/semantic-calibrate.ts <workspaceId>
```

The script reads read-only rows with `mode = 'shadow'` for the workspace and prints:

- `agree`: semantic rung equals keyword rung.
- `semanticHigher` / `semanticLower`: semantic rung is above or below the keyword rung.
- `noSemantic`: no semantic rung (below the anchor threshold, or no signal).
- `fit p50` / `fit p90`: nearest-rank percentiles over all non-null fits. Nearest rank
  takes the value at rank ceil(p/100 * n) of the sorted fits, so each value is an
  observed fit.
- The 20 largest disagreements, by absolute rung gap, with title and both rungs.

Read the disagreements by hand. Decide which side is right for each. A high
`semanticHigher` count with poor-looking titles suggests the anchor threshold is too
low. A high `noSemantic` count with good fits suggests it is too high.

## Rollout rule

1. Set `VANTAGE_SEMANTIC_MODE=shadow` in production. Keyword scoring is unchanged.
2. Collect shadow rows for at least 200 real documents.
3. Run the calibration report and review the disagreements.
4. Adjust `SEMANTIC_THRESHOLDS` if the review shows a problem, and rerun the tests.
5. Only then move to `on`.
