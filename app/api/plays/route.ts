import { NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import {
  isSettablePlayStatus,
  listForOpportunity,
  PlayNotFoundError,
  setStatus,
  suggestForOpportunity,
} from "@/lib/plays/repository";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidId() {
  return NextResponse.json({ error: "invalid id" }, { status: 400 });
}

function failure(label: string, err: unknown) {
  if (err instanceof PlayNotFoundError) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[plays ${label}]`, message);
  return NextResponse.json({ error: "plays request failed" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspaceId = str(url.searchParams.get("workspaceId"));
    const opportunityId = str(url.searchParams.get("opportunityId"));
    if (!workspaceId || !opportunityId) {
      return NextResponse.json(
        { error: "workspaceId and opportunityId are required" },
        { status: 400 },
      );
    }
    if (!UUID.test(opportunityId)) return invalidId();
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }
    const plays = await listForOpportunity({ workspaceId, opportunityId });
    return NextResponse.json({ plays });
  } catch (err) {
    return failure("GET", err);
  }
}

/** Suggest plays for an opportunity. Idempotent: existing kinds are not re-created. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const workspaceId = str(body.workspaceId);
    const opportunityId = str(body.opportunityId);
    if (!workspaceId || !opportunityId) {
      return NextResponse.json(
        { error: "workspaceId and opportunityId are required" },
        { status: 400 },
      );
    }
    if (!UUID.test(opportunityId)) return invalidId();
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }
    await suggestForOpportunity({ workspaceId, opportunityId });
    const plays = await listForOpportunity({ workspaceId, opportunityId });
    return NextResponse.json({ plays }, { status: 201 });
  } catch (err) {
    return failure("POST", err);
  }
}

/** Accept or dismiss a play. This records the user's decision; it never acts on a platform. */
export async function PATCH(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const workspaceId = str(body.workspaceId);
    const playId = str(body.playId);
    if (!workspaceId || !playId) {
      return NextResponse.json(
        { error: "workspaceId and playId are required" },
        { status: 400 },
      );
    }
    if (!isSettablePlayStatus(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    if (!UUID.test(playId)) return invalidId();
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }
    const updated = await setStatus({ workspaceId, playId, status: body.status });
    return NextResponse.json({ play: updated });
  } catch (err) {
    return failure("PATCH", err);
  }
}
