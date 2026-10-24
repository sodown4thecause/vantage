import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUserId } from "@/lib/auth/admin";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { getDb } from "@/lib/db/client";
import { document, heroExample, opportunity, opportunityEvidence } from "@/lib/db/schema";
import { isPublicHttpUrl } from "@/lib/http/public-fetch";
import { validHeroExcerpt } from "@/lib/public/hero-examples";

const promotion = z.object({
  workspaceId: z.uuid(),
  opportunityId: z.uuid(),
  documentId: z.uuid(),
  excerpt: z.string().min(1).max(2000),
  approvePublicDisplay: z.literal(true),
}).strict();

export async function POST(req: Request) {
  const actor = await getAdminUserId();
  if (!actor) return NextResponse.json({ error: "not found" }, { status: 404 });
  const site = req.headers.get("sec-fetch-site");
  if (req.headers.get("origin") !== new URL(req.url).origin ||
    (site && site !== "same-origin" && site !== "none")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let input: z.infer<typeof promotion>;
  try {
    const body = await req.text();
    if (new TextEncoder().encode(body).length > 12_000) {
      return NextResponse.json({ error: "invalid_input" }, { status: 413 });
    }
    const parsed = promotion.safeParse(JSON.parse(body));
    if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const access = await authorizeWorkspace(input.workspaceId);
  if (!access.ok || access.userId !== actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const db = getDb();
    const [row] = await db.select({
      platform: document.platform,
      title: document.title,
      sourceUrl: document.urlCanonical,
      content: document.contentMd,
      postedAt: document.postedAt,
      metadata: document.metadata,
    }).from(opportunityEvidence)
      .innerJoin(opportunity, and(
        eq(opportunity.id, opportunityEvidence.opportunityId),
        eq(opportunity.workspaceId, input.workspaceId),
      ))
      .innerJoin(document, and(
        eq(document.id, opportunityEvidence.documentId),
        eq(document.workspaceId, input.workspaceId),
      ))
      .where(and(
        eq(opportunityEvidence.workspaceId, input.workspaceId),
        eq(opportunityEvidence.opportunityId, input.opportunityId),
        eq(opportunityEvidence.documentId, input.documentId),
      )).limit(1);
    if (!row || !row.title || !row.postedAt || row.metadata?.mocked === true ||
      !isPublicHttpUrl(row.sourceUrl) || !validHeroExcerpt(input.excerpt, row.content)) {
      return NextResponse.json({ error: "invalid_source" }, { status: 400 });
    }
    const url = new URL(row.sourceUrl);
    const redditCommunity = row.platform === "reddit" ? url.pathname.match(/^\/r\/([\w-]+)(?:\/|$)/i)?.[1] : null;
    await db.insert(heroExample).values({
      platform: row.platform,
      community: redditCommunity ? `r/${redditCommunity}` : url.hostname,
      title: row.title,
      sourceUrl: row.sourceUrl,
      excerpt: input.excerpt,
      postedAt: row.postedAt,
      approvedBy: actor,
      approvedAt: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "promotion_unavailable" }, { status: 503 });
  }
}
