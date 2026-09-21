import { handleCollectorPost } from "@/lib/collectors/route";
import { redditCollector } from "@/lib/collectors/reddit";

export async function POST(req: Request) {
  return handleCollectorPost(req, redditCollector, "reddit");
}
