import { NextResponse } from "next/server";

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
