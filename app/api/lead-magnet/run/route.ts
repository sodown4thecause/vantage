import { NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { runFreeScan } from "@/lib/lead-magnet/run";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      workspaceId?: unknown;
    };
    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 },
      );
    }

    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }

    const result = await runFreeScan(workspaceId);
    return NextResponse.json(result, { status: result.ok ? 200 : 429 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[lead-magnet/run] failed", { error: message });
    return NextResponse.json(
      { error: "free scan failed" },
      { status: 500 },
    );
  }
}
