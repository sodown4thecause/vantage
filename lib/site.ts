/** Public identity of the marketing site. One place for name, URL and copy used in metadata. */
export const SITE_NAME = "contextfor.dev";

export const SITE_TAGLINE = "Find the people already asking for what you build.";

export const SITE_DESCRIPTION =
  "contextfor.dev reads Reddit, Hacker News, X, YouTube, GitHub, Stack Overflow and more for people asking for what you build, then hands you a short daily list of conversations worth joining. You write the reply; it never posts for you.";

/** Absolute origin for canonical URLs, sitemaps and feeds. Set NEXT_PUBLIC_SITE_URL per environment. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://contextfor.dev").replace(/\/+$/, "");
}

export function absoluteUrl(path = "/"): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Sources the collectors read, in the order the product copy lists them. */
export const SOURCES = [
  "Reddit",
  "Hacker News",
  "X",
  "YouTube",
  "Product Hunt",
  "Substack",
  "GitHub",
  "Stack Overflow",
  "LinkedIn",
  "Your RSS feeds",
] as const;
