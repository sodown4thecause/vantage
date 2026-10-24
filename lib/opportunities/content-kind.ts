export type EvidenceContentKind = "preview" | "page_excerpt" | "thread";

const LABELS: Record<EvidenceContentKind, string> = {
  preview: "Search snippet only",
  page_excerpt: "Page excerpt",
  thread: "Full thread",
};

export function parseContentKind(value: unknown): EvidenceContentKind | null {
  return value === "preview" || value === "page_excerpt" || value === "thread" ? value : null;
}

/** How much of the source Vantage actually read, in words the workspace owner can act on. */
export function contentKindLabel(kind: EvidenceContentKind | null | undefined): string | null {
  return kind ? LABELS[kind] : null;
}
