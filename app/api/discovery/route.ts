import { NextResponse } from "next/server";

import { ingestReviewedSources, listPendingProposals, runDiscovery, saveDiscoveryProposals } from "@/lib/agents/discovery";
import { captureServerException } from "@/lib/analytics/server";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { isPublicHttpUrl } from "@/lib/http/public-fetch";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Initial agent discovery. The owner sends only their product URL. The agent reads the site through Linkup and
 * proposes a profile, competitors, keywords and sources; this handler stores the proposals for the owner to confirm
 * and ingests only the sources the quality gate accepted. The response carries the typed tool results so a UI can
 * render cards straight away. Nothing is posted, and the agent itself writes nothing.
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid request" }, { status: 400 }); }
  const { workspaceId, productUrl } = (body ?? {}) as Record<string, unknown>;
  if (typeof workspaceId !== "string" || !UUID_RE.test(workspaceId) || typeof productUrl !== "string" || !isPublicHttpUrl(productUrl.trim())) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });

  const url = productUrl.trim();
  try {
    const outcome = await runDiscovery({ workspaceId, productUrl: url, kind: "initial", signal: req.signal });
    if (outcome.status === "not_configured") return NextResponse.json({ error: "discovery_unavailable" }, { status: 503 });
    await saveDiscoveryProposals({ workspaceId, productUrl: url, outcome });
    const ingestion = await ingestReviewedSources(workspaceId);
    return NextResponse.json({
      status: outcome.status,
      results: outcome.results,
      ingested: ingestion.ingested,
      spend: { modelUsd: outcome.modelCostUsd, toolsUsd: outcome.toolSpendUsd },
    });
  } catch (error) {
    if (error instanceof PaidCallDeniedError) {
      return error.code === "budget_exhausted"
        ? NextResponse.json({ error: "discovery_budget_used" }, { status: 402 })
        : NextResponse.json({ error: "discovery_unavailable" }, { status: 503 });
    }
    await captureServerException(error, { workspaceId, area: "discovery" });
    console.error("[discovery] run failed");
    return NextResponse.json({ error: "discovery failed" }, { status: 500 });
  }
}

/** The workspace's pending proposals, for the cards a UI renders: the latest profile draft, competitors, keywords and reviewed sources. */
export async function GET(req: Request): Promise<Response> {
  const workspaceId = new URL(req.url).searchParams.get("workspaceId")?.trim();
  if (!workspaceId || !UUID_RE.test(workspaceId)) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });

  return NextResponse.json(await listPendingProposals(workspaceId));
}
