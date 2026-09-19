import { handleCollectorPost } from "@/lib/collectors/route";
import { youtubeCollector } from "@/lib/collectors/youtube";

export async function POST(req: Request) {
  return handleCollectorPost(req, youtubeCollector, "youtube");
}
