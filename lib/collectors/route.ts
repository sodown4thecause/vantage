import { NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { runCollectorForType } from "@/lib/collectors/run";
import type { Collector, SourceType } from "@/lib/collectors/types";

export type { SourceType };

export async function handleCollectorPost(
  req: Request,
  collector: Collector,
  sourceType: SourceType,
) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      workspaceId?: string;
      sourceId?: string;
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
    const results = await runCollectorForType({
      collector,
      workspaceId: body.workspaceId,
      sourceId: body.sourceId,
      sourceType,
    });
    const failed = results.filter((r) => r.error);
    const publicResults = results.map(({ error, ...result }) =>
      error ? { ...result, error: "collector failed" } : result,
    );
    return NextResponse.json(
      { results: publicResults },
      { status: failed.length && failed.length === results.length ? 502 : 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[collector route] request failed", {
      collector: collector.name,
      error: message,
    });
    return NextResponse.json(
      { error: "collector request failed" },
      { status: 500 },
    );
  }
}
