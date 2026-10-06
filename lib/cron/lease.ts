import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

export async function withWorkspaceScanLease<T>(workspaceId: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const db = getDb();
  const token = crypto.randomUUID();
  const [claimed] = await db.update(workspace).set({
    scanLeaseToken: token, scanLeaseUntil: sql`now() + interval '5 minutes'`,
  }).where(and(eq(workspace.id, workspaceId), or(isNull(workspace.scanLeaseUntil), lt(workspace.scanLeaseUntil, sql`now()`))))
    .returning({ id: workspace.id });
  if (!claimed) throw new Error("Workspace scan already running.");
  try { return await run(AbortSignal.timeout(120_000)); }
  finally {
    await db.update(workspace).set({ scanLeaseToken: null, scanLeaseUntil: null, updatedAt: new Date() })
      .where(and(eq(workspace.id, workspaceId), eq(workspace.scanLeaseToken, token)));
  }
}
