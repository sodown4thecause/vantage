import { NextResponse } from "next/server";

import { getAdminUserId } from "@/lib/auth/admin";
import { sourceSwitchStateValues, type SourceSwitchState } from "@/lib/db/schema";
import { isSourceSwitchKey } from "@/lib/sources/keys";
import { listSourceSwitches, setSourceSwitch } from "@/lib/sources/switch";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

export async function GET() {
  if (!(await getAdminUserId())) return notFound();
  try {
    return NextResponse.json({ switches: await listSourceSwitches() });
  } catch (err) {
    console.error("[admin/switches] list failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "switch list failed" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const adminId = await getAdminUserId();
  if (!adminId) return notFound();
  try {
    const body = (await req.json().catch(() => ({}))) as {
      sourceKey?: unknown;
      state?: unknown;
      reason?: unknown;
    };
    if (!isSourceSwitchKey(body.sourceKey)) {
      return NextResponse.json({ error: "unknown sourceKey" }, { status: 400 });
    }
    if (!(sourceSwitchStateValues as readonly unknown[]).includes(body.state)) {
      return NextResponse.json({ error: "invalid state" }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    await setSourceSwitch({
      sourceKey: body.sourceKey,
      state: body.state as SourceSwitchState,
      reason,
      changedBy: adminId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/switches] update failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "switch update failed" }, { status: 500 });
  }
}
