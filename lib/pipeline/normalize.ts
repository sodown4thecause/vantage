import type { Document } from "@/lib/db/schema";

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

/** Strip HTML leftovers, collapse whitespace, drop empty docs. */
export function normalizeDocument(doc: Document): NormalizedDocument | null {
  const raw = [doc.title ?? "", doc.contentMd ?? ""].join("\n");
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

export function normalizeDocuments(docs: Document[]): NormalizedDocument[] {
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
