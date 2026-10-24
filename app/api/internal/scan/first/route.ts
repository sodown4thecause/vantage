import { eq } from "drizzle-orm";

import { firstScanStep } from "@/lib/activation/run";
import { internalStep } from "@/lib/cron/steps";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Workflows have no user session; internalStep requires the fail-closed service bearer before any database access.
  return internalStep(req, "first", ["workspaceId"], async ({ workspaceId }, signal, body) => {
    const [ws] = await getDb().select({ id: workspace.id }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1);
    if (!ws) return Response.json({ error: "not found" }, { status: 404 });
    return firstScanStep(workspaceId, body as Record<string, unknown>, signal);
  });
}
