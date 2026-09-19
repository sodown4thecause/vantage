import fixture from "@/test/fixtures/youtube.json";

export type YouTubeComment = {
  id: string;
  videoId: string;
  videoTitle: string;
  author: string;
  text: string;
  publishedAt: string;
  likeCount: number;
  videoUrl: string;
};

/**
 * YouTube Data API client.
 * Never calls search.list. Uses comment fixtures when YOUTUBE_API_KEY is unset.
 */
export async function fetchYouTubeComments(opts?: {
  videoIds?: string[];
}): Promise<YouTubeComment[]> {
  const key = process.env.YOUTUBE_API_KEY;
  const all = fixture.comments as YouTubeComment[];
  if (!key) {
    if (opts?.videoIds?.length) {
      return all.filter((c) => opts.videoIds!.includes(c.videoId));
    }
    return all;
  }

  // Live path: commentThreads.list only (no search.list).
  const videoIds =
    opts?.videoIds?.length
      ? opts.videoIds
      : [...new Set(all.map((c) => c.videoId))];

  const out: YouTubeComment[] = [];
  for (const videoId of videoIds) {
    const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("videoId", videoId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("textFormat", "plainText");
    url.searchParams.set("key", key);
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) {
      throw new Error(`YouTube API ${res.status} for video ${videoId}`);
    }
    const json = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet?: {
          topLevelComment?: {
            snippet?: {
              authorDisplayName?: string;
              textDisplay?: string;
              publishedAt?: string;
              likeCount?: number;
              videoId?: string;
            };
          };
        };
      }>;
    };
    for (const item of json.items ?? []) {
      const sn = item.snippet?.topLevelComment?.snippet;
      if (!sn?.textDisplay) continue;
      out.push({
        id: item.id,
        videoId,
        videoTitle: videoId,
        author: sn.authorDisplayName ?? "unknown",
        text: sn.textDisplay,
        publishedAt: sn.publishedAt ?? new Date().toISOString(),
        likeCount: sn.likeCount ?? 0,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }
  }
  return out;
}
