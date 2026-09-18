import { hnCollector } from "@/lib/collectors/hn";
import { handleCollectorPost } from "@/lib/collectors/route";

export async function POST(req: Request) {
  return handleCollectorPost(req, hnCollector, "hn");
}
