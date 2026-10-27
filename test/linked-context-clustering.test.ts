import { describe, expect, it } from "vitest";

import type { DocumentRecord } from "@/lib/db/schema";
import { clusterKeyForDocuments } from "@/lib/opportunities/features";
import { normalizeDocument } from "@/lib/pipeline/normalize";

function post(id: string, title: string, summary?: string) {
  return {
    id, workspaceId: "ws", title, contentMd: "", urlCanonical: `https://example.com/${id}`,
    platform: "reddit", authorRef: null, contentHash: id, postedAt: new Date(), collectedAt: new Date(),
    metadata: summary ? { linkedContext: { url: `https://example.com/${id}`, kind: "page", title: null, summary } } : {},
  } as unknown as DocumentRecord;
}

describe("linked page summaries and grouping", () => {
  it("scoring text carries the summary", () => {
    expect(normalizeDocument(post("a", "Gardening tips", "Tomatoes love sun"))?.text)
      .toContain("Linked page: Tomatoes love sun");
  });

  it("does not group unrelated link posts on the 'Linked page' label", () => {
    const a = normalizeDocument(post("a", "Gardening tips", "Tomatoes love sun"))!;
    const b = normalizeDocument(post("b", "Quarterly earnings", "Revenue grew steadily"))!;
    const key = clusterKeyForDocuments([a, b]);
    expect(key).not.toMatch(/linked|page/);
  });

  it("keeps a document's cluster key stable when enrichment arrives later", () => {
    const before = normalizeDocument(post("a", "Gardening tips for spring"))!;
    const after = normalizeDocument(post("a", "Gardening tips for spring", "Tomatoes love sun"))!;
    expect(clusterKeyForDocuments([after])).toBe(clusterKeyForDocuments([before]));
  });
});
