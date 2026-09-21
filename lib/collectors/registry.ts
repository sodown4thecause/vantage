import { hnCollector } from "@/lib/collectors/hn";
import { productHuntCollector } from "@/lib/collectors/producthunt";
import { redditCollector } from "@/lib/collectors/reddit";
import { rssCollector } from "@/lib/collectors/rss";
import { substackCollector } from "@/lib/collectors/substack";
import type { Collector, SourceType } from "@/lib/collectors/types";
import { xCollector } from "@/lib/collectors/x";
import { youtubeCollector } from "@/lib/collectors/youtube";

export const collectorsByType: Record<SourceType, Collector | undefined> = {
  hn: hnCollector,
  rss: rssCollector,
  substack: substackCollector,
  producthunt: productHuntCollector,
  youtube: youtubeCollector,
  reddit: redditCollector,
  x: xCollector,
  web_search: undefined,
  other: undefined,
};

export const allCollectors: Collector[] = [
  hnCollector,
  rssCollector,
  substackCollector,
  productHuntCollector,
  youtubeCollector,
  redditCollector,
  xCollector,
];
