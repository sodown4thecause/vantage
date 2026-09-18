import { contentHash } from "@/lib/collectors/hash";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import { rssCollector } from "@/lib/collectors/rss";

function publicationFeedUrl(config: Record<string, unknown>): string {
  if (typeof config.feedUrl === "string" && config.feedUrl.trim()) {
    return config.feedUrl.trim();
  }
  const pub = config.publication ?? config.subdomain;
  if (typeof pub === "string" && pub.trim()) {
    const host = pub.includes(".")
      ? pub.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : `${pub.trim()}.substack.com`;
    return `https://${host}/feed`;
  }
  throw new Error(
    "Substack source config requires feedUrl or publication/subdomain",
  );
}

/**
 * Post-only Substack collector via publication RSS.
 * Comment-page scraping is intentionally out of scope for M1.
 * Paid posts surface only the RSS-visible preview body.
 */
export const substackCollector: Collector = {
  name: "substack",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    const feedUrl = publicationFeedUrl(ctx.config);
    const result = await rssCollector.run({
      ...ctx,
      config: { ...ctx.config, feedUrl },
    });
    return {
      nextState: result.nextState,
      documents: result.documents.map((d) => ({
        ...d,
        platform: "substack",
        contentHash: contentHash([
          "substack",
          feedUrl,
          d.urlCanonical,
          d.title,
          d.contentMd,
        ]),
        metadata: { ...(d.metadata ?? {}), feedUrl, kind: "post" },
      })),
    };
  },
};
