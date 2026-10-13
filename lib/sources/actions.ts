"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { sha256Hex } from "@/lib/collectors/hash";
import { getDb } from "@/lib/db/client";
import { source, type NewSource } from "@/lib/db/schema";
import { isPublicHttpUrl } from "@/lib/http/public-fetch";
import { assertWithinCount } from "@/lib/plans/limits";
import { PlanLimitError } from "@/lib/plans/types";
import { scanWorkspace } from "@/lib/cron/scan";
import { COMMUNITY_SOURCE_CATALOG } from "@/lib/communities/catalog";
import { collectorsByType } from "@/lib/collectors/registry";
import { runCollector } from "@/lib/collectors/run";
import { withWorkspaceScanLease } from "@/lib/cron/lease";
import { ScanLeaseBusyError } from "@/lib/cron/lease-error";
import { buildOpportunities } from "@/lib/opportunities/run";
import { PROFILE_SOURCE_NAME } from "@/lib/profile/repository";
import { enqueueEmbedJob } from "@/lib/cf/queue";
import { getSemanticMode } from "@/lib/cf/env";
import { buildSearchSource } from "@/lib/sources/search";

export type SourceActionState = { error?: string; message?: string };
export type CommunitySourceActionState = SourceActionState & { catalogId: string };

async function installSource(workspaceId: string, value: Pick<NewSource, "name" | "type" | "lane" | "config">, message: string): Promise<SourceActionState> {
  return withWorkspaceScanLease(workspaceId, async signal => {
    const db = getDb();
    const rows = await db.select({ name: source.name }).from(source).where(eq(source.workspaceId, workspaceId)).limit(100);
    if (rows.some(row => row.name === value.name)) return { message: "This source is already configured." };
    // Leave room for onboarding's one idempotent default source, even if it runs concurrently.
    await assertWithinCount(workspaceId, "sources", rows.length + (rows.some(row => row.name === PROFILE_SOURCE_NAME) ? 0 : 1));
    signal.throwIfAborted();
    await db.insert(source).values({ workspaceId, ...value })
      .onConflictDoNothing({ target: [source.workspaceId, source.name] });
    // Best effort: a missed enqueue only defers embedding to the next scan's embed step. Mode "off" enqueues nothing.
    if (getSemanticMode() !== "off") await enqueueEmbedJob({ type: "backfill-documents", workspaceId });
    revalidatePath("/settings/sources");
    return { message };
  });
}

export async function addCommunitySource(workspaceId: string, _previous: SourceActionState, form: FormData): Promise<CommunitySourceActionState> {
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    const catalogId = String(form.get("catalogId") ?? "");
    if (!authorization.ok) return { catalogId, error: "Unable to add sources for this workspace." };
    const entry = COMMUNITY_SOURCE_CATALOG.find(e => e.id === catalogId);
    if (!entry) return { catalogId, error: "Choose a source from the community catalog." };
    const name = `Community: ${entry.name}`;
    return { ...await installSource(workspaceId, { name, type: entry.type, lane: entry.lane,
      config: { ...entry.config, catalogId: entry.id, rulesUrl: entry.rulesUrl } },
      entry.lane === "free" ? "Source added. Run a scan to collect it." : "Source added. It needs provider access, which the site operator configures; use Scan this source to check it."), catalogId };
  } catch (error) {
    return { catalogId: String(form.get("catalogId") ?? ""),
      error: error instanceof PlanLimitError ? error.message : "Community source could not be added. Please try again." };
  }
}

/** Adds a keyword search on one platform, then scans it so the customer sees live posts straight away. */
export async function addSearchSource(workspaceId: string, _previous: SourceActionState, form: FormData): Promise<SourceActionState> {
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) return { error: "Unable to add sources for this workspace." };
    const built = buildSearchSource({
      platform: String(form.get("platform") ?? ""),
      query: String(form.get("query") ?? ""),
      subreddit: String(form.get("subreddit") ?? ""),
      tag: String(form.get("tag") ?? ""),
    });
    if (!built.ok) return { error: built.error };
    const installed = await installSource(workspaceId, built.source, "Search added.");
    const [row] = await getDb().select({ id: source.id }).from(source)
      .where(and(eq(source.workspaceId, workspaceId), eq(source.name, String(built.source.name)))).limit(1);
    if (!row) return { error: "Search could not be added. Please try again." };
    const scanned = await scanSource(workspaceId, row.id);
    if (scanned.error) {
      return { error: `${installed.message} The first scan did not finish: check its status below and try "Scan this source" again.` };
    }
    // Pass the scan's own outcome through (it may be paused); never claim posts were found.
    return { message: `${installed.message} ${scanned.message ?? ""} Anything it found is listed under "Latest posts found".`.replace(/\s+/g, " ").trim() };
  } catch (error) {
    if (error instanceof PlanLimitError) return { error: error.message };
    return { error: error instanceof ScanLeaseBusyError ? "A scan is already running for this workspace. Try again in a minute." : "Search could not be added. Please try again." };
  }
}

export async function scanSource(workspaceId: string, sourceId: string): Promise<SourceActionState> {
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) return { error: "Unable to scan this workspace." };
    const [row] = await getDb().select().from(source).where(and(eq(source.workspaceId, workspaceId), eq(source.id, sourceId))).limit(1);
    const collector = row && collectorsByType[row.type];
    if (!collector) return { error: "Source is unavailable." };
    if (row.health === "paused") return { message: "This source is paused." };
    const result = await withWorkspaceScanLease(workspaceId, async signal => {
      const receipt = await runCollector({ workspaceId, sourceId, collector, signal });
      if (!receipt.error && !receipt.switchedOff) await buildOpportunities({ workspaceId, limitDocs: 50, signal });
      return receipt;
    });
    revalidatePath("/settings/sources"); revalidatePath("/queue");
    return result.error ? { error: "Source could not be scanned. Check its coverage status." } : { message: result.switchedOff ? "Source is paused by the operator." : "Source scanned. The opportunity queue is refreshed." };
  } catch { return { error: "Source could not be scanned. Check provider access, budget, and coverage." }; }
}

export async function scanNow(workspaceId: string): Promise<SourceActionState> {
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) throw new Error(authorization.error);
    // The owner pressed the button: include their keyed Reddit and forum/blog searches, which cron never runs.
    const result = await scanWorkspace(workspaceId, undefined, { includeKeyed: true });
    revalidatePath("/queue");
    revalidatePath("/settings/sources");
    const attempted = (result.collectorResults as Array<Record<string, unknown>>).filter((row) => "sourceId" in row);
    const paused = attempted.filter((row) => row.reason === "source paused").length;
    if ([...result.collectorResults, ...result.opportunityResults].some((row) => "error" in row)) {
      return { error: "Some sources could not be scanned. Check their status on the Sources page." };
    }
    if (paused > 0 && paused === attempted.length) {
      return { message: "All sources checked in this scan are paused by the operator, so nothing was fetched. The opportunity queue was rebuilt from existing data." };
    }
    if (paused > 0) {
      return { message: `Scan completed. ${paused} source${paused === 1 ? " is" : "s are"} paused by the operator and were skipped.` };
    }
    return { message: "Scan completed. The opportunity queue is refreshed." };
  } catch (error) {
    return { error: error instanceof ScanLeaseBusyError ? error.message : "Scan could not be completed. Please try again." };
  }
}

export async function addFeed(workspaceId: string, _previous: SourceActionState, form: FormData): Promise<SourceActionState> {
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) throw new Error(authorization.error);
    const feedUrl = String(form.get("feedUrl") ?? "").trim();
    if (feedUrl.length > 2_000 || !isPublicHttpUrl(feedUrl)) throw new Error("Enter a public HTTP(S) feed URL.");
    const name = `RSS: ${new URL(feedUrl).hostname} (${sha256Hex(feedUrl).slice(0, 10)})`;
    return await installSource(workspaceId, { name, type: "rss", lane: "free", config: { feedUrl } }, "Feed added. Run a scan to collect its latest entries.");
  } catch (error) {
    if (error instanceof PlanLimitError) return { error: error.message };
    const message = error instanceof Error ? error.message : "";
    return { error: ["Enter a public HTTP(S) feed URL."].includes(message) ? message : "Feed could not be added. Please try again." };
  }
}
