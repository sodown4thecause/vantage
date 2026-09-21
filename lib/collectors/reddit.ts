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
    const limit = Number(ctx.config.limit ?? ctx.config.first ?? 20);
    const { posts, meta, cursor } = await fetchRedditPostsWithMeta({
      query,
      limit,
      cursor: ctx.cursor ?? undefined,
    });

    const documents: NewDocument[] = posts.map((p) => {
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
        postedAt: parseValidDate(p.createdAt),
        contentMd: body,
        contentHash: contentHash("reddit", p.url, body),
        rawSnapshotRef: `reddit:${p.id}`,
        metadata: {
          subreddit: p.subreddit,
          score: p.score,
          numComments: p.numComments,
          provider: meta.provider,
          mocked: meta.provider === "fixture",
        },
      };
    });

    return {
      documents,
      nextState: {
        cursor: cursor === undefined ? new Date().toISOString() : cursor,
      },
    };
  },
};
