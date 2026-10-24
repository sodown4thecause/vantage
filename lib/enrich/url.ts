import { createHash } from "node:crypto";

export type LinkedKind = "page" | "youtube";

/** Hosts whose own pages are never enriched (the post is the content). */
const SKIP_HOST_SUFFIXES = ["reddit.com", "x.com", "twitter.com"];

export type NormalisedLink = {
  url: string;
  urlHash: string;
  kind: LinkedKind;
};

/** True when a URL points at a PDF, which Firecrawl bills for and we cap by size. */
export function isPdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

export function isSkippedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SKIP_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

/**
 * Canonical form of a linked page's URL: tracking parameters (utm_*) and
 * fragments stripped, remaining parameters sorted, so one page hashes to one key.
 */
export function normaliseLinkedUrl(raw: string): NormalisedLink | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) parsed.searchParams.delete(key);
  }
  const entries = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const search = new URLSearchParams(entries).toString();
  const url = `${parsed.origin}${parsed.pathname}${search ? `?${search}` : ""}`;
  const host = parsed.hostname.toLowerCase();
  const kind: LinkedKind =
    (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") ? "youtube" : "page";
  return { url, urlHash: createHash("sha256").update(url).digest("hex"), kind };
}

const URL_RE = /https?:\/\/[^\s<>"'()\[\]{}]+/g;

/**
 * The URLs worth enriching for a short link post, best first: links written in
 * the body, then the document's canonical URL (an HN link item's article).
 */
export function candidateLinkUrls(doc: {
  urlCanonical: string;
  title: string | null;
  contentMd: string;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...(doc.contentMd.match(URL_RE) ?? []), doc.urlCanonical]) {
    const link = normaliseLinkedUrl(raw);
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link.url);
  }
  return out;
}
