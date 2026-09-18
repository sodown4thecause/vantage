import { contentHash } from "@/lib/collectors/hash";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import { fetchProductHuntPosts } from "@/lib/producthunt/client";
import type { NewDocument } from "@/lib/db/schema";

export const productHuntCollector: Collector = {
  name: "producthunt",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    const first = Number(ctx.config.first ?? 20);
    const posts = await fetchProductHuntPosts({ first });
    const documents: NewDocument[] = posts.map((p) => {
      const body = [`# ${p.name}`, p.tagline, "", p.description].join("\n");
      return {
        workspaceId: ctx.workspaceId,
        sourceId: ctx.sourceId,
        urlCanonical: p.url,
        platform: "producthunt",
        authorRef: p.maker ?? null,
        title: p.name,
        postedAt: p.createdAt ? new Date(p.createdAt) : null,
        contentMd: body,
        contentHash: contentHash("producthunt", p.url, body),
        rawSnapshotRef: `ph:${p.id}`,
        metadata: {
          votesCount: p.votesCount,
          topics: p.topics,
          website: p.website,
          mocked: !process.env.PH_DEV_TOKEN,
        },
      };
    });
    return {
      documents,
      nextState: { cursor: new Date().toISOString() },
    };
  },
};
