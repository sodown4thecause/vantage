import { contentHash } from "@/lib/collectors/hash";
import { parseValidDate } from "@/lib/collectors/date";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";
import { fetchXPostsWithMeta } from "@/lib/x/client";

export const xCollector: Collector = {
  name: "x",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    const query =
      typeof ctx.config.query === "string" ? ctx.config.query : undefined;
    const limit = Number(ctx.config.limit ?? ctx.config.first ?? 20);
    const searchTypeRaw =
      typeof ctx.config.searchType === "string" ? ctx.config.searchType : undefined;
    const searchType =
      searchTypeRaw === "Top" ||
      searchTypeRaw === "Latest" ||
      searchTypeRaw === "People" ||
      searchTypeRaw === "Photos" ||
      searchTypeRaw === "Videos"
        ? searchTypeRaw
        : undefined;

    const { posts, meta, cursor } = await fetchXPostsWithMeta({
      query,
      limit,
      cursor: ctx.cursor ?? undefined,
      searchType,
    });

    const documents: NewDocument[] = posts.map((p) => {
      const body = [
        p.author ? `@${p.author.replace(/^@/, "")}` : null,
        "",
        p.text,
      ]
        .filter((line) => line != null)
        .join("\n");
      return {
        workspaceId: ctx.workspaceId,
        sourceId: ctx.sourceId,
        urlCanonical: p.url,
        platform: "x",
        authorRef: p.author ?? null,
        title: p.text.slice(0, 120),
        postedAt: parseValidDate(p.createdAt),
        contentMd: body,
        contentHash: contentHash("x", p.url, body),
        rawSnapshotRef: `x:${p.id}`,
        metadata: {
          likeCount: p.likeCount,
          repostCount: p.repostCount,
          replyCount: p.replyCount,
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
