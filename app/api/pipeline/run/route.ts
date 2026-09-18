import { NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { runPipeline } from "@/lib/pipeline/run";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      workspaceId?: string;
      limit?: number;
      threshold?: number;
    };
    if (!body.workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 },
      );
    }
    const authorization = await authorizeWorkspace(body.workspaceId);
    if (!authorization.ok) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }
    const result = await runPipeline({
      workspaceId: body.workspaceId,
      limit: body.limit,
      threshold: body.threshold,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
