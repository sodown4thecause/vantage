import type { ContentDraftFormat } from "./contracts";
import type { ContentDraftRow } from "./repository";

export type ContentDraftStatusFilter = "all" | ContentDraftRow["status"];
export type ContentDraftFormatFilter = "all" | ContentDraftFormat;

export type ContentLibraryFilters = {
  status: ContentDraftStatusFilter;
  format: ContentDraftFormatFilter;
  source: string;
};

const markdownLinkPattern = /https?:\/\/[^\s<>"'`]+/gi;

function cleanMarkdownUrl(match: string, markdown: string, index: number): string {
  let candidate = match;
  const beforeLink = markdown.slice(0, index);
  const emphasisMarker = /(\*{1,3}|_{1,3})\[[^\]]*\]\($/.exec(beforeLink)?.[1]
    ?? /(\*{1,3}|_{1,3})$/.exec(beforeLink)?.[1];
  if (emphasisMarker && candidate.endsWith(emphasisMarker)) {
    candidate = candidate.slice(0, -emphasisMarker.length);
  }

  candidate = candidate.replace(/[.,!?;:]+$/, "");
  for (const [opening, closing] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (candidate.endsWith(closing)) {
      const openings = candidate.split(opening).length - 1;
      const closings = candidate.split(closing).length - 1;
      if (closings <= openings) break;
      candidate = candidate.slice(0, -1);
    }
  }
  return candidate;
}

export function contentDraftSourceLinks(markdown: string): string[] {
  const links = new Set<string>();
  for (const match of markdown.matchAll(markdownLinkPattern)) {
    const candidate = cleanMarkdownUrl(match[0], markdown, match.index ?? 0);
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") links.add(url.toString());
    } catch {
      // Ignore malformed links instead of making a broken source filter or export.
    }
  }
  return [...links];
}

function sourceDomain(link: string): string | null {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function contentDraftSourceDomains(drafts: ContentDraftRow[]): string[] {
  return [...new Set(drafts.flatMap((draft) => contentDraftSourceLinks(draft.body).map(sourceDomain)
    .filter((domain): domain is string => Boolean(domain))))].sort((left, right) => left.localeCompare(right));
}

export function contentDraftsForLibrary(
  drafts: ContentDraftRow[],
  filters: ContentLibraryFilters,
): ContentDraftRow[] {
  return drafts.filter((draft) => {
    if (filters.status !== "all" && draft.status !== filters.status) return false;
    if (filters.format !== "all" && draft.format !== filters.format) return false;
    if (filters.source !== "all" && !contentDraftSourceLinks(draft.body).some((link) => sourceDomain(link) === filters.source)) return false;
    return true;
  });
}

export function contentDraftsAsMarkdown(draft: ContentDraftRow): string {
  const body = draft.body.trim();
  const sources = contentDraftSourceLinks(body);
  const sourceSection = sources.length > 0
    ? `\n\n## Sources\n\n${sources.map((link) => `- [${sourceDomain(link) ?? link}](${link})`).join("\n")}`
    : "";
  return `# ${draft.title.trim()}\n\n${body}${sourceSection}\n`;
}

export function contentDraftFilename(title: string): string {
  const safeName = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${safeName || "content-draft"}.md`;
}
