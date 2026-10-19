"use server";

import { redirect } from "next/navigation";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { fetchAnchors, fetchBacklinkSummary, fetchReferringDomains, normalizeTarget } from "@/lib/dataforseo/backlinks";
import { DataForSeoDeniedError } from "@/lib/dataforseo/gate";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";

function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** `/seo?…` with empty values left out. */
function seoUrl(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/seo?${query}` : "/seo";
}

/** Maps a thrown lookup error to the `error=` code the page shows. Provider detail never leaves this function. */
function errorCode(err: unknown): string {
  if (err instanceof DataForSeoDeniedError) return err.code;
  if (err instanceof PaidCallDeniedError) return "paused";
  return "failed";
}

/**
 * Runs the backlink lookups for a domain (and optionally a competitor), then redirects back to the page,
 * which renders only what is already cached. Redirects are issued after the try blocks: redirect() throws.
 */
export async function runBacklinkReport(formData: FormData): Promise<void> {
  const workspaceId = formText(formData, "workspaceId");
  if (!workspaceId) redirect("/seo?error=forbidden");

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) redirect("/seo?error=forbidden");

  const rawTarget = formText(formData, "target");
  const rawCompetitor = formText(formData, "competitor");
  const target = normalizeTarget(rawTarget);
  const competitor = rawCompetitor ? normalizeTarget(rawCompetitor) : "";
  if (!target || competitor === null) {
    // Whatever did not normalize keeps the typed text, so the user can correct it; the rest keeps its normalized form.
    redirect(seoUrl({
      workspaceId,
      target: target ?? rawTarget,
      competitor: competitor ?? rawCompetitor,
      error: "invalid_target",
    }));
  }

  let error: string | undefined;
  try {
    await fetchBacklinkSummary(workspaceId, target);
    await fetchReferringDomains(workspaceId, target);
    await fetchAnchors(workspaceId, target);
    if (competitor) await fetchReferringDomains(workspaceId, competitor);
  } catch (err) {
    error = errorCode(err);
    if (error === "failed") {
      console.error("[seo] backlink lookup failed", { error: err instanceof Error ? err.name : "unknown" });
    }
  }

  redirect(seoUrl({ workspaceId, target, competitor, error }));
}
