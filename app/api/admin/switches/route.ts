import { NextResponse } from "next/server";

import { getAdminUserId } from "@/lib/auth/admin";
import { isSourceSwitchKey, isSourceSwitchState } from "@/lib/sources/keys";
import { listSourceSwitches, setSourceSwitch } from "@/lib/sources/switch";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * Defence in depth against cross-site requests on this privileged route. Browsers always send Fetch Metadata
 * (Sec-Fetch-Site) and send Origin on cross-origin writes, so either one pointing elsewhere is rejected.
 * Non-browser clients send neither and are still authenticated by the admin session.
 */
function isCrossOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(req.url).origin;
  } catch {
    return true;
  }
}

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
  if (isCrossOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const raw: unknown = await req.json().catch(() => null);
    const body: { sourceKey?: unknown; state?: unknown; reason?: unknown } =
      typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
    if (!isSourceSwitchKey(body.sourceKey)) {
      return NextResponse.json({ error: "unknown sourceKey" }, { status: 400 });
    }
    if (!isSourceSwitchState(body.state)) {
      return NextResponse.json({ error: "invalid state" }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    await setSourceSwitch({
      sourceKey: body.sourceKey,
      state: body.state,
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
