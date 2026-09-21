import { NextResponse } from "next/server";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import {
  getLatestMonitoringProfile,
  getMonitoringProfileVersion,
  saveMonitoringProfile,
} from "@/lib/profile/repository";
import { validateMonitoringProfileInput } from "@/lib/profile/validate";

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
    return NextResponse.json({ profile }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[profile route] POST failed", { error: message });
    return NextResponse.json(
      { error: "profile request failed" },
      { status: 500 },
    );
  }
}
