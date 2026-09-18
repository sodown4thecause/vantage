import { NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { normalizePipelineOptions } from "@/lib/pipeline/options";
import { runPipeline } from "@/lib/pipeline/run";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      workspaceId?: string;
      limit?: unknown;
      threshold?: unknown;
    };
    if (!body.workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 },
      );
    }
    let options: ReturnType<typeof normalizePipelineOptions>;
    try {
      options = normalizePipelineOptions(body);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "invalid options" },
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
      ...options,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipeline route] request failed", { error: message });
    return NextResponse.json(
      { error: "pipeline request failed" },
      { status: 500 },
    );
  }
}
