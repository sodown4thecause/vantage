import { NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import {
  approveDraftForHandoff,
  createDraftForOpportunity,
  getLatestDraft,
  updateDraftText,
} from "@/lib/drafting/repository";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim();
    const opportunityId = url.searchParams.get("opportunityId")?.trim();
    if (!workspaceId || !opportunityId) {
      return NextResponse.json(
        { error: "workspaceId and opportunityId are required" },
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
    const draft = await getLatestDraft({ workspaceId, opportunityId });
    return NextResponse.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[drafts GET]", message);
    return NextResponse.json({ error: "draft request failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
    const opportunityId =
      typeof body.opportunityId === "string" ? body.opportunityId.trim() : "";
    const action = typeof body.action === "string" ? body.action : "create";

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

    if (action === "create") {
      if (!opportunityId) {
        return NextResponse.json(
          { error: "opportunityId is required" },
          { status: 400 },
        );
      }
      const draft = await createDraftForOpportunity({
        workspaceId,
        opportunityId,
      });
      return NextResponse.json({ draft }, { status: 201 });
    }

    if (action === "update") {
      const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
      const editedText =
        typeof body.editedText === "string" ? body.editedText : "";
      if (!draftId) {
        return NextResponse.json(
          { error: "draftId is required" },
          { status: 400 },
        );
      }
      const draft = await updateDraftText({
        workspaceId,
        draftId,
        editedText,
      });
      return NextResponse.json({ draft });
    }

    if (action === "approve") {
      const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
      if (!draftId) {
        return NextResponse.json(
          { error: "draftId is required" },
          { status: 400 },
        );
      }
      try {
        const draft = await approveDraftForHandoff({ workspaceId, draftId });
        return NextResponse.json({ draft });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[drafts POST]", message);
    return NextResponse.json({ error: "draft request failed" }, { status: 500 });
  }
}
