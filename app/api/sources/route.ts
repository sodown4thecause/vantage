import { NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { listWorkspaceSources } from "@/lib/sources/list";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim();
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

    const sources = await listWorkspaceSources(workspaceId);
    return NextResponse.json({ sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sources route] GET failed", { error: message });
    return NextResponse.json(
      { error: "sources request failed" },
      { status: 500 },
    );
  }
}
