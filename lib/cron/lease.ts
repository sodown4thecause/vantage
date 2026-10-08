import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

// Single conditional UPDATE: succeeds only when the lease is unset or expired (neon-http has no transactions).
export async function claimScanLease(workspaceId: string, ttlMinutes: number): Promise<string | null> {
  if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) throw new RangeError("ttlMinutes must be a positive integer.");
  const db = getDb();
  const token = crypto.randomUUID();
  const [claimed] = await db.update(workspace).set({
    scanLeaseToken: token, scanLeaseUntil: sql`now() + make_interval(mins => ${ttlMinutes})`,
  }).where(and(eq(workspace.id, workspaceId), or(isNull(workspace.scanLeaseUntil), lt(workspace.scanLeaseUntil, sql`now()`))))
    .returning({ id: workspace.id });
  return claimed ? token : null;
}

// Clears the lease only while it still carries this token, so a stale holder cannot release a newer lease.
export async function releaseScanLease(workspaceId: string, token: string): Promise<void> {
  const db = getDb();
  await db.update(workspace).set({ scanLeaseToken: null, scanLeaseUntil: null, updatedAt: new Date() })
    .where(and(eq(workspace.id, workspaceId), eq(workspace.scanLeaseToken, token)));
}

export async function withWorkspaceScanLease<T>(workspaceId: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const token = await claimScanLease(workspaceId, 5);
  if (!token) throw new Error("Workspace scan already running.");
  try { return await run(AbortSignal.timeout(120_000)); }
  finally { await releaseScanLease(workspaceId, token); }
}
