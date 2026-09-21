import { NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { buildOpportunities } from "@/lib/opportunities/run";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      workspaceId?: string;
      limitDocs?: unknown;
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

    const limitDocs =
      typeof body.limitDocs === "number" && Number.isFinite(body.limitDocs)
        ? body.limitDocs
        : undefined;

    const result = await buildOpportunities({ workspaceId, limitDocs });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[opportunities/run] failed", { error: message });
    return NextResponse.json(
      { error: "opportunity build failed" },
      { status: 500 },
    );
  }
}
