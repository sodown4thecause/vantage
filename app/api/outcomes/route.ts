import { NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import {
  appendOutcome,
  getNorthStarMetric,
  isOutcomeEvent,
  listOutcomes,
} from "@/lib/outcomes/repository";

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
    if (url.searchParams.get("metric") === "north-star") {
      const metric = await getNorthStarMetric({ workspaceId });
      return NextResponse.json({ metric });
    }
    const opportunityId = url.searchParams.get("opportunityId")?.trim();
    const outcomes = await listOutcomes({
      workspaceId,
      opportunityId: opportunityId || undefined,
    });
    return NextResponse.json({ outcomes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[outcomes GET]", message);
    return NextResponse.json({ error: "outcomes request failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
    const opportunityId =
      typeof body.opportunityId === "string" ? body.opportunityId.trim() : "";
    if (!workspaceId || !opportunityId) {
      return NextResponse.json(
        { error: "workspaceId and opportunityId are required" },
        { status: 400 },
      );
    }
    if (!isOutcomeEvent(body.event)) {
      return NextResponse.json({ error: "invalid event" }, { status: 400 });
    }
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }
    const outcome = await appendOutcome({
      workspaceId,
      opportunityId,
      event: body.event,
      draftId: typeof body.draftId === "string" ? body.draftId : null,
      payload:
        body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
          ? (body.payload as Record<string, unknown>)
          : {},
      idempotencyKey:
        typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
    });
    return NextResponse.json({ outcome }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[outcomes POST]", message);
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { error: status === 404 ? message : "outcomes request failed" },
      { status },
    );
  }
}
