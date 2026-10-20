import { tool } from "ai";
import { z } from "zod";

import type { ToolContext } from "@/lib/seo-agent/tools/shared";

const MAX_FOLLOW_UP_CHARS = 140;

export function followUpTools(ctx: ToolContext) {
  const line = z.string().trim().min(1).max(MAX_FOLLOW_UP_CHARS);
  return {
    suggest_follow_ups: tool({
      description: "Record three short follow-ups (one SEO, one GEO, one content) tied to this answer. Call it last, once.",
      inputSchema: z.object({ seo: line, geo: line, content: line }).strict(),
      strict: true,
      execute: async ({ seo, geo, content }) => {
        const followUps = { seo: seo.trim(), geo: geo.trim(), content: content.trim() };
        const valid = Object.values(followUps).every((text) => text.length > 0 && text.length <= MAX_FOLLOW_UP_CHARS);
        if (!valid) return { error: "invalid_follow_ups" };
        ctx.followUps = followUps;
        return { ok: true };
      },
    }),
  };
}
