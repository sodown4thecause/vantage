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
| `on` | Same recording as `shadow`, rows written with `mode = 'on'`. Reserved for after calibration; the caller contract in `lib/pipeline/shadow.ts` says results must not feed scoring until then. |

Scoring degrades to keyword-only when the AI or Vectorize binding is missing or a call
fails. Semantic failures never fail a scan.

## Signals and thresholds

`SEMANTIC_THRESHOLDS` in `lib/pipeline/semantic.ts`:

| Constant | Value | Used by |
| --- | --- | --- |
| `anchor` | 0.6 | `semanticRung` is set only when the nearest anchor similarity is at least this value. Below it the rung is null. |
| `fit` | 0.5 | Declared but not yet applied in code. |
| `duplicate` | 0.92 | Declared but not yet applied in code. Provisional. |

- `semanticRung`: rung of the nearest anchor (the rung scale is the intent ladder: 0 noise,
  1 awareness, 2 research, 3 comparison, 4 purchase or recommend), or null.
- `semanticFit`: highest cosine between the document and the workspace profile vectors
  (top 3 matches). Recorded even when `semanticRung` is null.
- `anchorSimilarity`: cosine to the nearest anchor.
- `keywordRung`: rung from `classifyIntent`, the deterministic keyword ladder.

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
