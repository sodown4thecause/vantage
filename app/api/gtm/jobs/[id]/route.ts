import { getGtmJob, requestGtmJobCancel } from "@/lib/gtm/chat/jobs";
import { ProposalAuthorizationError } from "@/lib/gtm/proposals/types";
import { z } from "zod";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const job = await getGtmJob({ workspaceId: new URL(req.url).searchParams.get("workspaceId") ?? "", jobId: (await context.params).id });
    return Response.json(job ?? { error: "not_found" }, { status: job ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: "unavailable" }, { status: error instanceof ProposalAuthorizationError ? error.status : 400 }); }
}
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return Response.json({ error: "forbidden" }, { status: 403 });
  const input = z.strictObject({ workspaceId: z.uuid(), requestId: z.uuid(), action: z.literal("cancel") }).safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    return Response.json(await requestGtmJobCancel({ workspaceId: input.data.workspaceId, jobId: (await context.params).id, requestId: input.data.requestId }));
  } catch (error) { return Response.json({ error: "unavailable" }, { status: error instanceof ProposalAuthorizationError ? error.status : 400 }); }
}
