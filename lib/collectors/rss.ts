import { XMLParser } from "fast-xml-parser";

import { contentHash, sha256Hex } from "@/lib/collectors/hash";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && v && "#text" in (v as object)) {
    return String((v as { "#text": unknown })["#text"] ?? "");
  }
  return "";
}

function feedUrl(config: Record<string, unknown>): string {
  const url = config.feedUrl ?? config.url;
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("RSS source config requires feedUrl");
  }
  return url.trim();
}

function safeUrlForError(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "[invalid feed URL]";
  }
}

export const rssCollector: Collector = {
  name: "rss",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    const url = feedUrl(ctx.config);
    const headers: Record<string, string> = {
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    };
    if (ctx.etag) headers["If-None-Match"] = ctx.etag;
    if (ctx.lastModified) headers["If-Modified-Since"] = ctx.lastModified;

    const res = await fetch(url, { headers, next: { revalidate: 0 } });
    if (res.status === 304) {
      return {
        documents: [],
        nextState: { etag: ctx.etag, lastModified: ctx.lastModified },
      };
    }
    if (!res.ok) {
      throw new Error(`RSS fetch ${res.status} for ${safeUrlForError(url)}`);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml);
    const channel = parsed?.rss?.channel ?? parsed?.feed;
    const items = asArray(
      channel?.item ?? channel?.entry ?? [],
    ) as Array<Record<string, unknown>>;

    const documents: NewDocument[] = [];
    for (const item of items) {
      const title = textOf(item.title);
      const link =
        textOf(item.link) ||
        textOf((item.link as { "@_href"?: string })?.["@_href"]) ||
        textOf(item.id) ||
        textOf(item.guid);
      const content =
        textOf(item["content:encoded"]) ||
        textOf(item.content) ||
        textOf(item.summary) ||
        textOf(item.description) ||
        title;
      const published =
        textOf(item.pubDate) ||
        textOf(item.published) ||
        textOf(item.updated) ||
        textOf(item["dc:date"]);
      const author =
        textOf(item.author) ||
        textOf(item["dc:creator"]) ||
        textOf((item.author as { name?: string })?.name);

      if (!link && !title) continue;

      const urlCanonical = link || `${url}#${sha256Hex(`${title}\n${content}`)}`;
      documents.push({
        workspaceId: ctx.workspaceId,
        sourceId: ctx.sourceId,
        urlCanonical,
        platform: "rss",
        authorRef: author || null,
        title: title || null,
        postedAt: published ? new Date(published) : null,
        contentMd: content,
        contentHash: contentHash("rss", urlCanonical, content),
        rawSnapshotRef: url,
        metadata: { feedUrl: url },
      });
    }

    return {
      documents,
      nextState: {
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
      },
    };
  },
};
