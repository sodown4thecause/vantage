import { firstScanStep } from "@/lib/activation/run";
import { internalStep } from "@/lib/cron/steps";
import { firstScanWorkspaceExists } from "@/lib/scan/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Workflows have no user session; internalStep requires the fail-closed service bearer before any database access.
  return internalStep(req, "first", ["workspaceId"], async ({ workspaceId }, signal, body) => {
    if (!(await firstScanWorkspaceExists(workspaceId))) return Response.json({ error: "not found" }, { status: 404 });
    return firstScanStep(workspaceId, body as Record<string, unknown>, signal);
  });
}
