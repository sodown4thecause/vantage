import { contentHash } from "@/lib/collectors/hash";
import { parseValidDate } from "@/lib/collectors/date";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";
import { fetchYouTubeCommentsWithMeta } from "@/lib/youtube/client";

export const youtubeCollector: Collector = {
  name: "youtube",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    const videoIds = Array.isArray(ctx.config.videoIds)
      ? ctx.config.videoIds.map(String)
      : undefined;
    const query =
      typeof ctx.config.query === "string" ? ctx.config.query : undefined;
    const { comments, meta } = await fetchYouTubeCommentsWithMeta({
      videoIds,
      query,
    });
    const documents: NewDocument[] = comments.map((c) => {
      const body = [
        `Video: ${c.videoTitle}`,
        `Author: ${c.author}`,
        "",
        c.text,
      ].join("\n");
      const urlCanonical = `${c.videoUrl}&lc=${c.id}`;
      return {
        workspaceId: ctx.workspaceId,
        sourceId: ctx.sourceId,
        urlCanonical,
        platform: "youtube",
        authorRef: c.author,
        title: c.videoTitle,
        postedAt: parseValidDate(c.publishedAt),
        contentMd: body,
        contentHash: contentHash("youtube", urlCanonical, body),
        rawSnapshotRef: `yt:${c.id}`,
        metadata: {
          videoId: c.videoId,
          likeCount: c.likeCount,
          provider: meta.provider,
          mocked: meta.provider === "fixture",
        },
      };
    });
    return {
      documents,
      nextState: { cursor: new Date().toISOString() },
    };
  },
};
