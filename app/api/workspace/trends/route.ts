import { z } from "zod";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { workspaceTrends } from "@/lib/trends/query";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const parsed = z.uuid().safeParse(new URL(req.url).searchParams.get("workspaceId"));
  if (!parsed.success || !(await authorizeWorkspace(parsed.data)).ok) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  try {
    const topics = await workspaceTrends(parsed.data);
    return Response.json({
      topics: topics.map(({ topic, total, wow, days }) => ({
        topic,
        total,
        wowChangePct: wow.changePct,
        status: wow.status,
        days,
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[trends] query failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Trends are unavailable. Please try again." }, { status: 503 });
  }
}
