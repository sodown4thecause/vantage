"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { sha256Hex } from "@/lib/collectors/hash";
import { getDb } from "@/lib/db/client";
import { source } from "@/lib/db/schema";
import { isPublicHttpUrl } from "@/lib/http/public-fetch";
import { assertWithinCount } from "@/lib/plans/limits";
import { PlanLimitError } from "@/lib/plans/types";
import { scanWorkspace } from "@/lib/cron/scan";

export type SourceActionState = { error?: string; message?: string };

export async function scanNow(workspaceId: string): Promise<SourceActionState> {
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) throw new Error(authorization.error);
    const result = await scanWorkspace(workspaceId);
    revalidatePath("/queue");
    revalidatePath("/settings/sources");
    const attempted = (result.collectorResults as Array<Record<string, unknown>>).filter((row) => "sourceId" in row);
    const paused = attempted.filter((row) => row.reason === "source paused").length;
    if ([...result.collectorResults, ...result.opportunityResults].some((row) => "error" in row)) {
      return { error: "Some sources could not be scanned. Check Sources & Coverage." };
    }
    if (paused > 0 && paused === attempted.length) {
      return { message: "All sources checked in this scan are paused by the operator, so nothing was fetched. The opportunity queue was rebuilt from existing data." };
    }
    if (paused > 0) {
      return { message: `Scan completed. ${paused} source${paused === 1 ? " is" : "s are"} paused by the operator and were skipped.` };
    }
    return { message: "Scan completed. The opportunity queue is refreshed." };
  } catch (error) {
    return { error: error instanceof Error && error.message === "Workspace scan already running." ? error.message : "Scan could not be completed. Please try again." };
  }
}

export async function addFeed(workspaceId: string, _previous: SourceActionState, form: FormData): Promise<SourceActionState> {
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) throw new Error(authorization.error);
    const feedUrl = String(form.get("feedUrl") ?? "").trim();
    if (feedUrl.length > 2_000 || !isPublicHttpUrl(feedUrl)) throw new Error("Enter a public HTTP(S) feed URL.");
    const db = getDb();
    const name = `RSS: ${new URL(feedUrl).hostname} (${sha256Hex(feedUrl).slice(0, 10)})`;
    const rows = await db.select({ name: source.name }).from(source).where(eq(source.workspaceId, workspaceId)).limit(100);
    if (rows.some((row) => row.name === name)) return { message: "This feed is already configured." };
    await assertWithinCount(workspaceId, "sources", rows.length);
    await db.insert(source).values({ workspaceId, name, type: "rss", lane: "free", config: { feedUrl } })
      .onConflictDoNothing({ target: [source.workspaceId, source.name] });
    revalidatePath("/settings/sources");
    return { message: "Feed added. Run a scan to collect its latest entries." };
  } catch (error) {
    if (error instanceof PlanLimitError) return { error: error.message };
    const message = error instanceof Error ? error.message : "";
    return { error: ["Enter a public HTTP(S) feed URL."].includes(message) ? message : "Feed could not be added. Please try again." };
  }
}
