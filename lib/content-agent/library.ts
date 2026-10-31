import type { ContentDraftFormat } from "./contracts";
import type { ContentDraftRow } from "./repository";

export type ContentDraftStatusFilter = "all" | ContentDraftRow["status"];
export type ContentDraftFormatFilter = "all" | ContentDraftFormat;

export type ContentLibraryFilters = {
  status: ContentDraftStatusFilter;
  format: ContentDraftFormatFilter;
  source: string;
};

// Markdown links first: [label](url) or [label](url "title"). The URL may hold
// balanced parentheses, e.g. Wikipedia links, but never whitespace.
const markdownLinkPattern = /\[[^\]]*\]\(\s*<?(https?:\/\/(?:[^\s()<>]|\([^\s()<>]*\))+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gi;
const bareUrlPattern = /https?:\/\/[^\s<>"'`]+/gi;

function cleanBareUrl(match: string): string {
  let candidate = match;
  // Strip trailing punctuation and Markdown emphasis in any order until stable,
  // so "**https://a.com/x**." and "_https://a.com/x_," both end at the URL.
  for (;;) {
    const before = candidate;
    candidate = candidate.replace(/[.,!?;:*_~]+$/, "");
    for (const [opening, closing] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
      while (candidate.endsWith(closing)) {
        const openings = candidate.split(opening).length - 1;
        const closings = candidate.split(closing).length - 1;
        if (closings <= openings) break;
        candidate = candidate.slice(0, -1);
      }
    }
    if (candidate === before) return candidate;
  }
}

function httpLink(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    // Ignore malformed links instead of making a broken source filter or export.
    return null;
  }
}

export function contentDraftSourceLinks(markdown: string): string[] {
  const found: { index: number; link: string | null }[] = [];
  // Blank out each Markdown link once it is read, so the bare-URL pass cannot
  // see its brackets and glue two adjacent links into one URL.
  const remaining = markdown.replace(markdownLinkPattern, (whole: string, url: string, index: number) => {
    found.push({ index, link: httpLink(url) });
    return " ".repeat(whole.length);
  });
  for (const match of remaining.matchAll(bareUrlPattern)) {
    found.push({ index: match.index ?? 0, link: httpLink(cleanBareUrl(match[0])) });
  }
  // Keep document order so source chips and exports list links as written.
  found.sort((left, right) => left.index - right.index);
  return [...new Set(found.map((entry) => entry.link).filter((link): link is string => Boolean(link)))];
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
