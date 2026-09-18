import { handleCollectorPost } from "@/lib/collectors/route";
import { substackCollector } from "@/lib/collectors/substack";

export async function POST(req: Request) {
  return handleCollectorPost(req, substackCollector, "substack");
}
