import { z } from "zod";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { updateContentDraftStatus } from "@/lib/content-agent/repository";

const updateSchema = z.object({
  workspaceId: z.uuid(),
  status: z.enum(["idea", "draft", "ready"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const id = z.uuid().safeParse((await params).id);
  const body = updateSchema.safeParse(raw);
  if (!id.success || !body.success) return Response.json({ error: "invalid_request" }, { status: 400 });

  try {
    const authorization = await authorizeWorkspace(body.data.workspaceId);
    if (!authorization.ok) return Response.json({ error: "forbidden" }, { status: authorization.status });

    const draft = await updateContentDraftStatus(body.data.workspaceId, id.data, body.data.status);
    if (!draft) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ draft });
  } catch {
    return Response.json({ error: "request_failed" }, { status: 500 });
  }
}
