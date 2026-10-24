import type { DocumentRecord } from "@/lib/db/schema";
import type { LinkedContext } from "@/lib/enrich/run";

export type NormalizedDocument = {
  id: string;
  workspaceId: string;
  urlCanonical: string;
  platform: string;
  title: string;
  authorRef: string | null;
  postedAt: Date | null;
  text: string;
  contentHash: string;
};

/** A linked-page summary recorded by the enricher; read-only for scoring. */
export function linkedContextOf(metadata: Record<string, unknown> | null | undefined): LinkedContext | null {
  const value = metadata?.linkedContext;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || typeof record.summary !== "string" || !record.summary.trim()) return null;
  return {
    url: record.url,
    kind: record.kind === "youtube" ? "youtube" : "page",
    title: typeof record.title === "string" ? record.title : null,
    summary: record.summary,
  };
}

/** Strip HTML leftovers, collapse whitespace, drop empty docs. */
export function normalizeDocument(
  doc: DocumentRecord,
): NormalizedDocument | null {
  const linked = linkedContextOf(doc.metadata);
  const raw = [doc.title ?? "", doc.contentMd ?? "", linked ? `Linked page: ${linked.summary}` : ""].join("\n");
  const text = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return {
    id: doc.id,
    workspaceId: doc.workspaceId,
    urlCanonical: doc.urlCanonical,
    platform: doc.platform,
    title: (doc.title ?? "").trim() || text.slice(0, 80),
    authorRef: doc.authorRef,
    postedAt: doc.postedAt,
    text,
    contentHash: doc.contentHash,
  };
}

export function normalizeDocuments(
  docs: DocumentRecord[],
): NormalizedDocument[] {
  const out: NormalizedDocument[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    const n = normalizeDocument(d);
    if (!n) continue;
    if (seen.has(n.contentHash)) continue;
    seen.add(n.contentHash);
    out.push(n);
  }
  return out;
}
