import { contentHash } from "@/lib/collectors/hash";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import type { NewDocument } from "@/lib/db/schema";
import { fetchYouTubeComments } from "@/lib/youtube/client";

export const youtubeCollector: Collector = {
  name: "youtube",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    const videoIds = Array.isArray(ctx.config.videoIds)
      ? ctx.config.videoIds.map(String)
      : undefined;
    const comments = await fetchYouTubeComments({ videoIds });
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
        postedAt: c.publishedAt ? new Date(c.publishedAt) : null,
        contentMd: body,
        contentHash: contentHash("youtube", urlCanonical, body),
        rawSnapshotRef: `yt:${c.id}`,
        metadata: {
          videoId: c.videoId,
          likeCount: c.likeCount,
          mocked: !process.env.YOUTUBE_API_KEY,
        },
      };
    });
    return {
      documents,
      nextState: { cursor: new Date().toISOString() },
    };
  },
};
