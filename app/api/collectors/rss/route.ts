import { handleCollectorPost } from "@/lib/collectors/route";
import { rssCollector } from "@/lib/collectors/rss";

export async function POST(req: Request) {
  return handleCollectorPost(req, rssCollector, "rss");
}
