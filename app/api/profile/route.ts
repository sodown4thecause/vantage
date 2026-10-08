import { after, NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import {
  getLatestMonitoringProfile,
  getMonitoringProfileVersion,
  saveMonitoringProfile,
} from "@/lib/profile/repository";
import { PlanLimitError } from "@/lib/plans/types";
import { validateMonitoringProfileInput } from "@/lib/profile/validate";
import { runEmbedJob } from "@/lib/embeddings/backfill";
import { enqueueEmbedJob } from "@/lib/cf/queue";
import { getSemanticMode } from "@/lib/cf/env";

/**
 * Best-effort: indexes the saved profile (profile vectors and product material) after the response
 * is sent. Used only when the queue is absent or rejects the message. Failures are logged by error
 * class only and never reach the client.
 */
function scheduleProfileIndex(workspaceId: string, profileId: string): void {
  const task = async () => {
    try {
      const result = await runEmbedJob({ type: "index-profile", workspaceId, profileId });
      if (result?.skipped === "unavailable") {
        console.error("[profile route] profile index unavailable");
      }
    } catch (err) {
      console.error("[profile route] material index failed", {
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

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

    const versionParam = url.searchParams.get("version");
    if (versionParam != null && versionParam !== "") {
      const version = Number(versionParam);
      if (!Number.isInteger(version) || version < 1) {
        return NextResponse.json(
          { error: "version must be a positive integer" },
          { status: 400 },
        );
      }
      const profile = await getMonitoringProfileVersion(workspaceId, version);
      if (!profile) {
        return NextResponse.json({ error: "profile not found" }, { status: 404 });
      }
      return NextResponse.json({ profile });
    }

    const profile = await getLatestMonitoringProfile(workspaceId);
    return NextResponse.json({ profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[profile route] GET failed", { error: message });
    return NextResponse.json(
      { error: "profile request failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
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

    const validated = validateMonitoringProfileInput(body);
    if (!validated.ok) {
      return NextResponse.json(
        { error: "validation failed", fieldErrors: validated.errors },
        { status: 400 },
      );
    }

    const profile = await saveMonitoringProfile({
      workspaceId,
      input: validated.value,
    });
    // Mode "off" spends nothing on indexing: no queue message and no direct material indexing.
    if (getSemanticMode() !== "off") {
      // Queue first; direct material indexing only when the queue is absent or rejects the message.
      const queued = await enqueueEmbedJob({ type: "index-profile", workspaceId, profileId: profile.id });
      if (!queued) scheduleProfileIndex(workspaceId, profile.id);
    }
    return NextResponse.json({ profile }, { status: 201 });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      const fieldErrors = err.key === "keywords" ? { topics: err.message } : undefined;
      return NextResponse.json({ error: err.message, code: err.code, ...(fieldErrors ? { fieldErrors } : {}) }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[profile route] POST failed", { error: message });
    return NextResponse.json(
      { error: "profile request failed" },
      { status: 500 },
    );
  }
}
