import { contentHash } from "@/lib/collectors/hash";
import { parseValidDate } from "@/lib/collectors/date";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";
import { assertRealProvider } from "@/lib/collectors/provenance";
import { fetchRedditPostsWithMeta, type RedditFetchMeta, type RedditPost } from "@/lib/reddit/client";

export const redditCollector: Collector = {
  name: "reddit",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    // Profile sources carry up to three topics in `queries`; customer searches carry one `query`.
    const queries = [...new Set((Array.isArray(ctx.config.queries) ? ctx.config.queries : [ctx.config.query])
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0).map(q => q.trim()))].slice(0, 3);
    const subreddit =
      typeof ctx.config.subreddit === "string" ? ctx.config.subreddit : undefined;
    const limit = Number(ctx.config.limit ?? ctx.config.first ?? 20);
    const posts: RedditPost[] = [];
    let meta: RedditFetchMeta | undefined;
    let cursor: string | null | undefined;
    let coveragePartial = false;
    // Share the limit so one busy topic cannot crowd out the others.
    const perQuery = queries.length > 1 && Number.isInteger(limit) ? Math.max(1, Math.ceil(limit / queries.length)) : limit;
    for (const query of queries.length ? queries : [undefined]) {
      let result: Awaited<ReturnType<typeof fetchRedditPostsWithMeta>>;
      try {
        result = await fetchRedditPostsWithMeta({
          ctx: { workspaceId: ctx.workspaceId, sourceKey: "reddit" },
          query,
          subreddit,
          limit: perQuery,
          lookbackHours: Number(ctx.config.lookbackHours) || undefined,
          cursor: ctx.cursor ?? undefined,
          signal: ctx.signal,
        });
      } catch (error) {
        ctx.signal?.throwIfAborted();
        if (!posts.length) throw error;
        coveragePartial = true;
        break;
      }
      meta ??= result.meta;
      cursor = queries.length > 1 ? null : result.cursor;
      for (const post of result.posts) {
        if (posts.length < limit && !posts.some(existing => existing.id === post.id)) posts.push(post);
      }
    }
    if (!meta) throw new Error("Reddit provider unavailable");
    assertRealProvider(meta, "reddit");

    const documents: NewDocument[] = posts.map((p) => {
      const postedAt = parseValidDate(p.createdAt);
      const publicationDateMissing = postedAt === null;
      // A search preview carries no votes or comment count: unknown, not zero.
      const engagementKnown = p.contentKind !== "preview" && (p.score !== null || p.numComments !== null);
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
          score: engagementKnown ? p.score : null,
          numComments: engagementKnown ? p.numComments : null,
          engagementKnown,
          provider: p.provider ?? meta.provider,
          mocked: meta.provider === "fixture",
          contentKind: p.contentKind,
          discoveryOnly: p.contentKind === "preview",
          publicationDateMissing,
          partial: publicationDateMissing,
          topComments: p.topComments,
          outboundUrl: p.outboundUrl,
        },
      };
    });

    const missingPublicationDates = documents.filter(document => document.postedAt === null).length;
    return {
      documents,
      partial: coveragePartial || missingPublicationDates > 0,
      coverageReason: coveragePartial ? "Some topic searches were deferred; retaining the conversations already found." : missingPublicationDates
        ? `${missingPublicationDates} Reddit post(s) have no supplied publication date; recency is unverified.`
        : undefined,
      nextState: {
        cursor: cursor === undefined ? new Date().toISOString() : cursor,
      },
    };
  },
};
