import { contentHash } from "@/lib/collectors/hash";
import { parseValidDate } from "@/lib/collectors/date";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";
import { fetchRedditPostsWithMeta } from "@/lib/reddit/client";

export const redditCollector: Collector = {
  name: "reddit",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    const query =
      typeof ctx.config.query === "string" ? ctx.config.query : undefined;
    const subreddit =
      typeof ctx.config.subreddit === "string" ? ctx.config.subreddit : undefined;
    const limit = Number(ctx.config.limit ?? ctx.config.first ?? 20);
    const { posts, meta, cursor } = await fetchRedditPostsWithMeta({
      ctx: { workspaceId: ctx.workspaceId, sourceKey: "reddit" },
      query,
      subreddit,
      limit,
      cursor: ctx.cursor ?? undefined,
      signal: ctx.signal,
    });

    const documents: NewDocument[] = posts.map((p) => {
      const postedAt = parseValidDate(p.createdAt);
      const publicationDateMissing = postedAt === null;
      const body = [
        p.subreddit ? `r/${p.subreddit}` : null,
        p.author ? `u/${p.author}` : null,
        "",
        `# ${p.title}`,
        "",
        p.body,
      ]
        .filter((line) => line != null)
        .join("\n");
      return {
        workspaceId: ctx.workspaceId,
        sourceId: ctx.sourceId,
        urlCanonical: p.url,
        platform: "reddit",
        authorRef: p.author ?? null,
        title: p.title,
        postedAt,
        contentMd: body,
        contentHash: contentHash("reddit", p.url, body),
        rawSnapshotRef: `reddit:${p.id}`,
        metadata: {
          subreddit: p.subreddit,
          score: p.score,
          numComments: p.numComments,
          provider: meta.provider,
          mocked: meta.provider === "fixture",
          contentKind: p.contentKind,
          discoveryOnly: p.contentKind === "preview",
          publicationDateMissing,
          partial: publicationDateMissing,
          topComments: p.topComments,
        },
      };
    });

    const missingPublicationDates = documents.filter(document => document.postedAt === null).length;
    return {
      documents,
      partial: missingPublicationDates > 0,
      coverageReason: missingPublicationDates
        ? `${missingPublicationDates} Reddit post(s) have no supplied publication date; recency is unverified.`
        : undefined,
      nextState: {
        cursor: cursor === undefined ? new Date().toISOString() : cursor,
      },
    };
  },
};
