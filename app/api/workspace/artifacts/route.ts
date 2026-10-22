import { z } from "zod";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { blockListSchema } from "@/lib/workspace/blocks";
import { SAVED_ARTIFACT_LANES } from "@/lib/workspace/saved-artifact-types";
import { countSavedArtifacts, createSavedArtifact, listSavedArtifacts, MAX_SAVED_ARTIFACTS } from "@/lib/workspace/saved-artifacts";

const bodySchema = z.object({
  workspaceId: z.uuid(),
  lane: z.enum(SAVED_ARTIFACT_LANES),
  title: z.string().trim().min(1).max(200),
  blocks: blockListSchema,
});

export async function GET(req: Request): Promise<Response> {
  const workspaceId = z.uuid().safeParse(new URL(req.url).searchParams.get("workspaceId"));
  if (!workspaceId.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const authorization = await authorizeWorkspace(workspaceId.data);
    if (!authorization.ok) return Response.json({ error: "forbidden" }, { status: authorization.status });
    return Response.json({ artifacts: await listSavedArtifacts(workspaceId.data) });
  } catch {
    return Response.json({ error: "request_failed" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const { workspaceId, lane, title, blocks } = parsed.data;
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) return Response.json({ error: "forbidden" }, { status: authorization.status });
    if (await countSavedArtifacts(workspaceId) >= MAX_SAVED_ARTIFACTS) {
      return Response.json({ error: "limit_reached", message: `You can keep up to ${MAX_SAVED_ARTIFACTS} saved items. Delete some to save more.` }, { status: 409 });
    }
    const artifact = await createSavedArtifact(workspaceId, { lane, title, blocks, createdBy: authorization.userId });
    return Response.json({ artifact }, { status: 201 });
  } catch {
    return Response.json({ error: "request_failed" }, { status: 500 });
  }
}
