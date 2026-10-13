# Data deletion

## Deleting a workspace

The workspace owner deletes a workspace from **Settings → Plan & usage** (`/settings/plan`) by typing the workspace name to confirm. Only the owner can do this. The deletion is permanent. It runs under the workspace scan lease, so it refuses with a "try again" message while a scan is running.

Implementation: `lib/workspace/actions.ts` (`deleteWorkspace`) and `lib/workspace/delete.ts` (`deleteWorkspaceData`).

### What is deleted

- The `workspace` row: name, owner link, plan, budget and digest settings, posting health, and the encrypted BYOK key material.
- Every row that references the workspace with `ON DELETE CASCADE`: `source`, `document`, `semantic_shadow`, `lead`, `monitoring_profile` (every version), `opportunity`, `opportunity_evidence`, `opportunity_draft`, `opportunity_outcome`, `workspace_preference_model`, `workspace_usage` and `play`.
- The workspace's Vectorize vectors: `doc:<documentId>` for each document, and `profile:<profileId>:<n>` and `material:<profileId>:<n>` for `n` from 0 to 63 for each monitoring profile. This step is best-effort (see below).

### What is kept

- `cost_event` rows. Their `workspace_id` is set to null, so provider cost history remains for platform reporting but no longer names the workspace.
- The sign-in account (Neon Auth user). Deleting a workspace does not remove it.
- Data no workspace owns: shared posts, the destination catalog, provider prices, plan limits and source switch logs.
- R2 artifacts under `<workspaceId>/`. See below.

### Best-effort steps

Vectors are removed before the row is deleted. The document and profile rows that name the vectors must still exist to read their ids. If Vectorize fails, the row is still deleted and the remaining vectors stay in the index. Cleanup stops at the first failed batch. No query can reach those vectors, because every query requires an owned workspace, but they are not removed.

R2 artifacts are not deleted by this action. Screenshots are written under `<workspaceId>/screenshot/` in the production `vantage-artifacts` bucket (staging uses `vantage-artifacts-staging`). No table stores their keys, and the bucket client in `lib/r2/artifacts.ts` exposes only `put`, so the code cannot list or delete them. The repository sets no lifecycle rule on the bucket, so these objects are kept until a lifecycle rule is configured or a delete path is added. Nothing in the app currently calls the screenshot writer.

### Backups

Neon point-in-time restore keeps earlier states of the database for the project's restore window. Deleted rows can be recovered from those states until that window passes.
