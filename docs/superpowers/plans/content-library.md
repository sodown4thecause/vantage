# Content library (Slice 6)

## Definition of done

- The Content page shows the workspace's complete saved-draft library below the writing workspace, with `idea`, `draft`, and `ready` statuses.
- Users can filter saved drafts by status, format, and source; source choices come from deduplicated HTTP(S) links found in Markdown bodies.
- A user can change a draft's status through an authorized, workspace-and-draft-scoped write.
- A user can download a Markdown export containing the draft body and its source links; no publishing, scheduling, migration, or paid AI call is introduced.

## Plan

1. Add focused tests for source extraction, filtering, export, workspace-authorized status changes, and repository query scoping; run them and record the expected red result.
2. Implement the source/export helpers, unbounded workspace-scoped library read, status mutation and API route, then add the standalone library UI beneath the existing Content workspace.
3. Run focused tests, the three required checks, UI/dataflow verification where local configuration permits, and an independent adversarial review; inspect the final diff and keep the change within the Content lane.
4. Commit and open a PR against `feat/content-brand-voice`, beginning with `Closes #155`; do not merge, deploy, or apply migrations.
