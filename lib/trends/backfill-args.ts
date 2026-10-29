export const BACKFILL_USAGE =
  "Usage: DATABASE_URL=... pnpm tsx scripts/backfill-topic-volume.ts <workspaceId>\n" +
  "Rebuilds the topic volume window for one workspace; run it once per workspace.";

/** The backfill takes exactly one workspace id; there is deliberately no all-workspaces mode. */
export function parseBackfillArgs(argv: string[]): { workspaceId: string } {
  const [workspaceId, ...rest] = argv.map((arg) => arg.trim());
  if (!workspaceId || rest.length > 0 || workspaceId.startsWith("-")) throw new Error(BACKFILL_USAGE);
  return { workspaceId };
}
