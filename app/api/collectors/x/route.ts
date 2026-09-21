import { handleCollectorPost } from "@/lib/collectors/route";
import { xCollector } from "@/lib/collectors/x";

export async function POST(req: Request) {
  return handleCollectorPost(req, xCollector, "x");
}
