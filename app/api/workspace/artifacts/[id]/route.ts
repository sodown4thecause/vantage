import { z } from "zod";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { deleteSavedArtifact } from "@/lib/workspace/saved-artifacts";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = z.uuid().safeParse((await params).id);
  const workspaceId = z.uuid().safeParse(new URL(req.url).searchParams.get("workspaceId"));
  if (!id.success || !workspaceId.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const authorization = await authorizeWorkspace(workspaceId.data);
    if (!authorization.ok) return Response.json({ error: "forbidden" }, { status: authorization.status });
    const deleted = await deleteSavedArtifact(workspaceId.data, id.data);
    return deleted ? new Response(null, { status: 204 }) : Response.json({ error: "not_found" }, { status: 404 });
  } catch {
    return Response.json({ error: "request_failed" }, { status: 500 });
  }
}
