import { NextResponse } from "next/server";

import { reviewIngestedDocuments } from "@/lib/agents/review";
import { internalStep } from "@/lib/cron/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Flags sources that keep returning irrelevant documents, for the owner to confirm (Workflow step: review). */
export async function POST(req: Request) {
  return internalStep(req, "review", ["workspaceId"], async ({ workspaceId }) =>
    NextResponse.json(await reviewIngestedDocuments(workspaceId)));
}
