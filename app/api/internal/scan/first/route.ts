import { firstScanStep } from "@/lib/activation/run";
import { internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return internalStep(req, "first", ["workspaceId"], ({ workspaceId }, signal, body) =>
    firstScanStep(workspaceId, body as Record<string, unknown>, signal));
}
