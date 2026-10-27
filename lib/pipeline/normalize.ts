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
  /**
   * The post's own words, without any linked-page summary. Grouping reads this
   * so enrichment can neither merge unrelated posts nor change a cluster key.
   * Absent means `text` is already the post's own words.
   */
  groupText?: string;
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
  const clean = (raw: string) => raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  const own = clean([doc.title ?? "", doc.contentMd ?? ""].join("\n"));
  const text = linked ? clean([own, `Linked page: ${linked.summary}`].join("\n")) : own;
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
    ...(linked ? { groupText: own } : {}),
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
