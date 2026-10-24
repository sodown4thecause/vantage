import { and, eq } from "drizzle-orm";

import { captureActivation } from "@/lib/analytics/activation";
import { readBinding } from "@/lib/cf/env";
import { getDb } from "@/lib/db/client";
import { scanRun } from "@/lib/db/schema";
import { releaseScanLease } from "@/lib/cron/lease";
import { firstScanId, recoverStaleFirstScan } from "@/lib/scan/repository";

type ScanBinding = {
  create(input: { id: string; params: { workspaceId: string; kind: "first" } }): Promise<unknown>;
  get(id: string): Promise<{ status(): Promise<{ status: string }>; restart(): Promise<void> }>;
};

export { firstScanId } from "@/lib/scan/repository";

export async function firstScan(workspaceId: string) {
  const [run] = await getDb().select().from(scanRun)
    .where(and(eq(scanRun.workspaceId, workspaceId), eq(scanRun.id, firstScanId(workspaceId)))).limit(1);
  return run ?? null;
}

export async function startFirstScan(workspaceId: string, retry = false): Promise<{ status: string }> {
  const id = firstScanId(workspaceId);
  try {
    const db = getDb();
    if (retry) await recoverStaleFirstScan(workspaceId);
    await db.insert(scanRun).values({ id, workspaceId, kind: "first", leaseToken: crypto.randomUUID() }).onConflictDoNothing();
    let run = await firstScan(workspaceId);
    if (!run) throw new Error("First scan row unavailable");
    if (retry) {
      const [claimed] = await db.update(scanRun).set({
        status: "queued", leaseToken: crypto.randomUUID(), sourceIds: null,
        read: 0, relevant: 0, picked: 0, startedAt: new Date(), finishedAt: null,
      }).where(and(eq(scanRun.id, id), eq(scanRun.workspaceId, workspaceId), eq(scanRun.status, "failed"))).returning();
      if (!claimed) return { status: run.status };
      await releaseScanLease(workspaceId, run.leaseToken);
      run = claimed;
    } else if (run.status !== "queued") {
      return { status: run.status };
    }
    const binding = await readBinding("SCAN") as ScanBinding | undefined;
    if (!binding || typeof binding.create !== "function") throw new Error("SCAN unavailable");
    if (retry) {
      let instance: Awaited<ReturnType<ScanBinding["get"]>> | undefined;
      try {
        instance = await binding.get(id);
        await instance.status();
      } catch (error) {
        if (!/not found|does not exist|404/i.test(String(error instanceof Error ? error.message : error))) throw error;
        instance = undefined;
      }
      if (instance) { await instance.restart(); return { status: "queued" }; }
    }
    try {
      await binding.create({ id, params: { workspaceId, kind: "first" } });
    } catch (error) {
      if (!/already (exist|used)/i.test(String(error instanceof Error ? error.message : error))) throw error;
    }
    await captureActivation("url_confirmed", workspaceId);
    return { status: "queued" };
  } catch {
    try {
      await getDb().update(scanRun).set({ status: "failed", finishedAt: new Date() })
        .where(and(eq(scanRun.id, id), eq(scanRun.workspaceId, workspaceId), eq(scanRun.status, "queued")));
      await captureActivation("first_scan_failed", workspaceId);
    } catch {}
    console.error("[activation] first scan dispatch failed");
    return { status: "failed" };
  }
}
