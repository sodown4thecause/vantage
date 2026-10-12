import type { NewSource } from "@/lib/db/schema";

/** Platforms a customer can search with their own keywords. */
export const SEARCH_PLATFORMS = {
  hn: { label: "Hacker News", lane: "free" },
  reddit: { label: "Reddit", lane: "byok" },
  stackoverflow: { label: "Stack Overflow", lane: "free" },
  github: { label: "GitHub issues", lane: "free" },
} as const;

export type SearchPlatform = keyof typeof SEARCH_PLATFORMS;

export type SearchInput = {
  platform: string;
  query: string;
  subreddit?: string;
  tag?: string;
};

export type SearchSource = Pick<NewSource, "name" | "type" | "lane" | "config">;

/** A week back on the first scan, so a new search shows results straight away; later scans continue from the cursor. */
const FIRST_SCAN_LOOKBACK_HOURS = 168;

const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,21}$/;
const SO_TAG_RE = /^[a-z0-9][a-z0-9.#+-]{0,34}$/;

function isSearchPlatform(value: string): value is SearchPlatform {
  return Object.hasOwn(SEARCH_PLATFORMS, value);
}

/**
 * Validates a customer's search and turns it into a source row. Pure: callers
 * authorize the workspace and enforce plan limits before inserting.
 */
export function buildSearchSource(input: SearchInput): { ok: true; source: SearchSource } | { ok: false; error: string } {
  const platform = input.platform.trim();
  if (!isSearchPlatform(platform)) return { ok: false, error: "Choose where to search." };

  // eslint-disable-next-line no-control-regex -- strip control characters from user input
  const query = input.query.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (query.length < 2 || query.length > 100) return { ok: false, error: "Enter a search phrase of 2 to 100 characters." };

  const { label, lane } = SEARCH_PLATFORMS[platform];
  switch (platform) {
    case "hn":
      return { ok: true, source: { name: `Search (${label}): ${query}`, type: "hn", lane,
        config: { queries: [query], maxPages: 1, lookbackHours: FIRST_SCAN_LOOKBACK_HOURS, search: true } } };
    case "github":
      return { ok: true, source: { name: `Search (${label}): ${query}`, type: "github", lane,
        config: { query, maxPages: 1, lookbackHours: FIRST_SCAN_LOOKBACK_HOURS, search: true } } };
    case "reddit": {
      const subreddit = (input.subreddit ?? "").trim().replace(/^\/?r\//i, "");
      if (subreddit && !SUBREDDIT_RE.test(subreddit)) {
        return { ok: false, error: "Enter a subreddit name like SaaS or webdev (letters, numbers and underscores)." };
      }
      const where = subreddit ? `r/${subreddit}` : label;
      return { ok: true, source: { name: `Search (${where}): ${query}`, type: "reddit", lane,
        config: { query, ...(subreddit ? { subreddit } : {}), limit: 10, search: true } } };
    }
    case "stackoverflow": {
      const tag = (input.tag ?? "").trim().toLowerCase();
      if (tag && !SO_TAG_RE.test(tag)) return { ok: false, error: "Enter a single Stack Overflow tag like next.js or seo." };
      const where = tag ? `${label} [${tag}]` : label;
      return { ok: true, source: { name: `Search (${where}): ${query}`, type: "stackoverflow", lane,
        config: { query, ...(tag ? { tagged: tag } : {}), includeReplies: true, maxPages: 1, search: true } } };
    }
  }
}
