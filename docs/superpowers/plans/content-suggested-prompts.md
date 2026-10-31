# Slice 5: suggested prompts

## Definition of done
- After workspace authorization, Content loads its top ranked current opportunities and latest profile topics through the existing workspace-scoped readers.
- Exactly three deterministic Australian-English prompts use that data; if either source is absent, three static fallback prompts are returned without a model call.
- Three prompt buttons remain above the composer and selecting one fills the composer.
- Tests cover populated data, missing scan/keywords, workspace isolation, and selection behaviour.

## Plan
1. Extend focused tests for a server helper that composes the existing scoped readers; run the tests before implementing it and observe failure.
2. Add the helper, keep deterministic template construction separate from the UI component, and make the smallest page integration change.
3. Run the focused regression tests, then the required typecheck, lint, and full Vitest commands in order; review the complete diff and lane boundary before publishing.

## Constraints
- No model/provider calls or spend, migrations, publishing, scheduling, or changes to parallel content slices.
- Base the feature branch on `origin/feat/content-brand-voice`; do not merge `main` or rewrite history.
