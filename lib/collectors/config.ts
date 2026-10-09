import { assertPublicHttpUrl } from "@/lib/collectors/safeFetch";
import type { SourceType } from "@/lib/collectors/types";

export const SOURCE_TYPE_VALUES: SourceType[] = [
  "hn",
  "rss",
  "substack",
  "reddit",
  "web_search",
  "producthunt",
  "youtube",
  "x",
  "other",
];

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  hn: "Hacker News",
  rss: "RSS / Atom feed",
  substack: "Substack",
  reddit: "Reddit",
  web_search: "Web search",
  producthunt: "Product Hunt",
  youtube: "YouTube",
  x: "X (Twitter)",
  other: "Other",
};

export type SourceConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: string };

export function isSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && SOURCE_TYPE_VALUES.includes(value as SourceType);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPublicHttpUrl(value: string): boolean {
  try {
    assertPublicHttpUrl(value);
    return true;
  } catch {
    return false;
  }
}

function parseVideoIds(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  const ids = raw.map((v) => v.trim()).filter(Boolean).slice(0, 10);
  return ids.length ? ids : undefined;
}

/**
 * Validate and normalize a source config for its collector type. Every field
 * the collectors read is checked here so a bad config fails at save time
 * rather than at the next sweep.
 */
export function validateSourceConfig(
  type: SourceType,
  input: Record<string, unknown>,
): SourceConfigResult {
  const query = text(input.query);

  switch (type) {
    case "rss": {
      const feedUrl = text(input.feedUrl);
      if (!feedUrl) return { ok: false, error: "RSS sources need a feed URL." };
      if (!isPublicHttpUrl(feedUrl)) {
        return {
          ok: false,
          error: "The feed URL must be a public http(s) address.",
        };
      }
      return { ok: true, config: { feedUrl } };
    }

    case "substack": {
      const feedUrl = text(input.feedUrl);
      const publication = text(input.publication) ?? text(input.subdomain);
      if (feedUrl) {
        if (!isPublicHttpUrl(feedUrl)) {
          return {
            ok: false,
            error: "The feed URL must be a public http(s) address.",
          };
        }
        return { ok: true, config: { feedUrl } };
      }
      if (!publication) {
        return {
          ok: false,
          error: "Substack sources need a publication or a feed URL.",
        };
      }
      return { ok: true, config: { publication } };
    }

    case "reddit": {
      if (!query) {
        return { ok: false, error: "Reddit sources need a search query." };
      }
      return { ok: true, config: { query } };
    }

    case "x":
    case "web_search": {
      if (!query) {
        return { ok: false, error: "This source needs a search query." };
      }
      return { ok: true, config: { query } };
    }

    case "hn": {
      if (!query) {
        return { ok: false, error: "Hacker News sources need a search query." };
      }
      return { ok: true, config: { query } };
    }

    case "youtube": {
      const videoIds = parseVideoIds(input.videoIds);
      if (!videoIds && !query) {
        return {
          ok: false,
          error: "YouTube sources need video IDs or a search query.",
        };
      }
      return {
        ok: true,
        config: {
          ...(query ? { query } : {}),
          ...(videoIds ? { videoIds } : {}),
        },
      };
    }

    case "producthunt":
      return { ok: true, config: query ? { query } : {} };

    case "other":
      return { ok: true, config: {} };
  }
}
