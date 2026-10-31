import { z } from "zod";

import { firstScan, startFirstScan } from "@/lib/activation/dispatch";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { getLimits, getWorkspacePlan } from "@/lib/plans/limits";
import { nothingStrongReason } from "@/lib/scan/nothing-strong";
import { getFirstScanStatus } from "@/lib/scan/repository";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const parsed = z.uuid().safeParse(new URL(req.url).searchParams.get("workspaceId"));
  if (!parsed.success || !(await authorizeWorkspace(parsed.data)).ok) return Response.json({ error: "not found" }, { status: 404 });
  const workspaceId = parsed.data;
  try {
    const { run, timeZone, lastPolledAt, scanHealth } = await getFirstScanStatus(workspaceId, await firstScan(workspaceId));
    const limits = await getLimits(await getWorkspacePlan(workspaceId));
    const last = lastPolledAt ? new Date(lastPolledAt).getTime() : Date.now();
    const nextScanAt = new Date(Math.max(Date.now(), last + limits.scan_interval_hours * 3600_000)).toISOString();
    return Response.json({
      run: run ? { status: run.status, read: run.read, relevant: run.relevant, picked: run.picked,
        costUsd: run.costUsd, capped: run.capped, startedAt: run.startedAt, finishedAt: run.finishedAt } : null,
      nextScanAt, timeZone, scanHealth,
      reason: nothingStrongReason(run?.read ?? 0) === "few_sources" ? "Few sources are configured. Check your sources or add one." : "Your topics may be too narrow. Try broader wording in your profile.",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[first-scan] status unavailable", error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : error instanceof Error ? "Error" : "UnknownError");
    return Response.json({ error: "Scan status is unavailable. Please try again." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const parsed = z.object({ workspaceId: z.uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !(await authorizeWorkspace(parsed.data.workspaceId)).ok) return Response.json({ error: "not found" }, { status: 404 });
  const result = await startFirstScan(parsed.data.workspaceId, true);
  return Response.json(result, { status: result.status === "failed" ? 503 : 202 });
}
