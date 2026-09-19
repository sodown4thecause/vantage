import { productHuntCollector } from "@/lib/collectors/producthunt";
import { handleCollectorPost } from "@/lib/collectors/route";

export async function POST(req: Request) {
  return handleCollectorPost(req, productHuntCollector, "producthunt");
}
