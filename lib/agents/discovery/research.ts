import { getDb } from "@/lib/db/client";
import { discoveryEvidence, discoveryResearchResult } from "@/lib/db/schema";
import { fetchPublicText, isPublicHttpUrl } from "@/lib/http/public-fetch";
import { fetchLinkupPage } from "@/lib/linkup/client";
import { artifactKey, putArtifact } from "@/lib/r2/artifacts";
import { discoveryBudgetContext, withDiscoveryBudget } from "./budget";
import type { ResearchEvidence } from "./types";

export const MAX_SELECTED_PAGES_PER_DOMAIN = 5;
export const MAX_RESEARCHED_COMPETITOR_DOMAINS = 3;

type Input = { workspaceId: string; url: string; requestId: string; signal: AbortSignal };

function readable(text: string): string {
  return text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function save(input: Input, url: string, body: string, provider: string, retrievedAt: string,
  contentKind: "full" | "preview", status: "verified" | "partial", unknowns: string[]): Promise<ResearchEvidence> {
  const id = crypto.randomUUID();
  const evidence: ResearchEvidence = { id, url, retrievedAt, excerpt: body.slice(0, 2000), provider, contentKind, status };
  const snapshotKey = await putArtifact(artifactKey(input.workspaceId, "snapshot", id), body, "text/plain; charset=utf-8");
  if (!snapshotKey) unknowns.push(`Private snapshot unavailable for ${url}; excerpt remains in the evidence registry.`);
  await getDb().insert(discoveryEvidence).values({
    id, workspaceId: input.workspaceId, requestId: input.requestId, url, originalUrl: input.url,
    retrievedAt: new Date(retrievedAt), excerpt: evidence.excerpt, provider, contentKind, status,
    snapshotKey, unknowns: [...unknowns],
  });
  return evidence;
}

async function researchOne(input: Input): Promise<{ evidence: ResearchEvidence[]; unknowns: string[] }> {
  const unknowns: string[] = [];
  if (!isPublicHttpUrl(input.url)) return { evidence: [], unknowns: ["A public HTTP(S) product URL is required."] };
  input.signal.throwIfAborted();
  let direct: Awaited<ReturnType<typeof fetchPublicText>> | null = null;
  try {
    direct = await fetchPublicText(input.url, { signal: input.signal, headers: { accept: "text/html,text/plain,application/xhtml+xml" } });
  } catch (error) {
    if (input.signal.aborted) throw error;
    unknowns.push(`Direct product retrieval failed (${error instanceof Error ? error.name : "unknown"}).`);
  }
  if (direct) {
    const { response, text } = direct;
    if (response.ok && readable(text)) {
      const observed = response.url && isPublicHttpUrl(response.url) ? response.url : null;
      if (!observed) unknowns.push("The direct response did not expose a verified final URL.");
      const evidence = await save(input, observed ?? input.url, readable(text), "direct", new Date().toISOString(),
        "full", observed ? "verified" : "partial", unknowns);
      return { evidence: [evidence], unknowns };
    }
    unknowns.push(response.status >= 300 && response.status < 400
      ? "The product URL redirected; its final target was not followed or verified."
      : `The product URL returned HTTP ${response.status} or no readable content.`);
  }
  try {
    const result = await fetchLinkupPage(input.url, { workspaceId: input.workspaceId, sourceKey: "discovery", signal: input.signal });
    const text = readable(result.value.markdown);
    const fetchedAt = result.value.fetchedAt;
    if (!text || !fetchedAt || !Number.isFinite(new Date(fetchedAt).getTime())) {
      unknowns.push(result.cached ? "Cached provider content lacks its original retrieval time." : "Provider returned no dated readable content.");
      return { evidence: [], unknowns };
    }
    unknowns.push("Provider returned the requested URL without an observed final page identity; coverage is partial.");
    const evidence = await save(input, input.url, text, "linkup", fetchedAt, "preview", "partial", unknowns);
    return { evidence: [evidence], unknowns };
  } catch (error) {
    if (input.signal.aborted) throw error;
    unknowns.push(`Provider fallback unavailable (${error instanceof Error ? error.name : "unknown"}).`);
    return { evidence: [], unknowns };
  }
}

/** A single bounded product page. The builder chooses at most five pages/domain and three competitor domains. */
export function researchProductSite(input: Input): Promise<{ evidence: ResearchEvidence[]; unknowns: string[] }> {
  const run = discoveryBudgetContext();
  if (run && (run.workspaceId !== input.workspaceId || run.requestId !== input.requestId)) {
    throw new Error("Discovery research context does not match the request.");
  }
  const work = async () => {
    const result = await researchOne(input);
    await getDb().insert(discoveryResearchResult).values({
      id: crypto.randomUUID(), workspaceId: input.workspaceId, requestId: input.requestId,
      url: input.url.slice(0, 2048), unknowns: result.unknowns,
    });
    return result;
  };
  return run ? work() : withDiscoveryBudget({ workspaceId: input.workspaceId, scope: "initial", requestId: input.requestId }, work);
}
