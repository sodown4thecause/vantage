import { contentHash } from "@/lib/collectors/hash";
import { parseValidDate } from "@/lib/collectors/date";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
} from "@/lib/collectors/types";
import { fetchProductHuntPostsWithMeta } from "@/lib/producthunt/client";
import type { NewDocument } from "@/lib/db/schema";

export const productHuntCollector: Collector = {
  name: "producthunt",
  async run(ctx: CollectorContext): Promise<CollectorResult> {
    const first = Number(ctx.config.first ?? 20);
    const query =
      typeof ctx.config.query === "string" ? ctx.config.query : undefined;
    const { posts, meta } = await fetchProductHuntPostsWithMeta({ first, query });
    const documents: NewDocument[] = posts.map((p) => {
      const body = [`# ${p.name}`, p.tagline, "", p.description].join("\n");
      return {
        workspaceId: ctx.workspaceId,
        sourceId: ctx.sourceId,
        urlCanonical: p.url,
        platform: "producthunt",
        authorRef: p.maker ?? null,
        title: p.name,
        postedAt: parseValidDate(p.createdAt),
        contentMd: body,
        contentHash: contentHash("producthunt", p.url, body),
        rawSnapshotRef: `ph:${p.id}`,
        metadata: {
          votesCount: p.votesCount,
          topics: p.topics,
          website: p.website,
          provider: meta.provider,
          mocked: meta.provider === "fixture",
        },
      };
    });
    return {
      documents,
      nextState: { cursor: new Date().toISOString() },
    };
  },
};
