import { z } from "zod";

/*
 * Typed visual blocks an assistant answer can carry alongside its text. Block content comes from providers and models,
 * so it is untrusted data: the client renders every value as React text and links only http(s) URLs.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const httpUrl = z.string().trim().max(2000).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}, { message: "Must be an http(s) URL" });

export const redditThreadBlockSchema = z.object({
  type: z.literal("reddit_thread"),
  subreddit: z.string().trim().max(100).nullable(),
  title: text(500),
  url: httpUrl,
  score: z.number().int().nullable(),
  excerpt: z.string().max(2000).default(""),
  comments: z.array(z.object({ body: text(2000), score: z.number().int().nullable().default(null) })).max(5).default([]),
});

const cell = z.union([z.string().max(500), z.number(), z.null()]);

export const tableBlockSchema = z.object({
  type: z.literal("table"),
  title: text(200),
  columns: z.array(text(80)).min(1).max(8),
  rows: z.array(z.array(cell)).max(100),
}).refine((table) => table.rows.every((row) => row.length === table.columns.length), {
  message: "Every row must have one cell per column",
});

export const chartBlockSchema = z.object({
  type: z.literal("chart"),
  kind: z.enum(["bar", "line"]),
  title: text(200),
  xLabel: z.string().max(80).default(""),
  yLabel: z.string().max(80).default(""),
  points: z.array(z.object({ label: text(40), value: z.number().finite() })).min(1).max(60),
});

export const textBlockSchema = z.object({
  type: z.literal("text"),
  text: text(12000),
});

export const researchCardBlockSchema = z.object({
  type: z.literal("research_card"),
  title: text(200),
  value: z.union([text(2000), z.number().finite()]),
  sourceUrl: httpUrl,
  sourceLabel: z.string().trim().max(120).optional(),
});

export const blockSchema = z.union([redditThreadBlockSchema, tableBlockSchema, chartBlockSchema, textBlockSchema, researchCardBlockSchema]);

export type RedditThreadBlock = z.infer<typeof redditThreadBlockSchema>;
export type TableBlock = z.infer<typeof tableBlockSchema>;
export type ChartBlock = z.infer<typeof chartBlockSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
export type ResearchCardBlock = z.infer<typeof researchCardBlockSchema>;
export type Block = z.infer<typeof blockSchema>;

export const MAX_BLOCKS = 12;

/** A short plain-text stand-in for a block that failed validation, so the answer still reads. */
function fallbackText(raw: unknown): string {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim().slice(0, 200) : "";
    if (typeof record.text === "string" && record.text.trim()) return record.text.trim().slice(0, 12000);
    if (title) return `${title} (this visual couldn't be displayed)`;
  }
  return "This visual couldn't be displayed.";
}

/**
 * Validates each block on its own. A block that fails validation becomes a text block, so one bad block never
 * hides the rest of the answer.
 */
export function parseBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_BLOCKS).map((item) => {
    const parsed = blockSchema.safeParse(item);
    return parsed.success ? parsed.data : { type: "text", text: fallbackText(item) };
  });
}

/** Strict form for writes (saving): every block must validate. */
export const blockListSchema = z.array(blockSchema).min(1).max(MAX_BLOCKS);

/** The subreddit named in a Reddit URL, if any. */
export function subredditFromUrl(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})(?:\/|$)/);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

type EvidencePost = {
  title: string | null;
  urlCanonical: string;
  platform: string;
  contentMd: string;
  existingReplies?: string[];
  score?: number | null;
  subreddit?: string | null;
};

/** Reddit evidence as conversation cards. Built from stored evidence, never from model output. */
export function redditThreadBlocks(evidence: { title: string; evidence: EvidencePost[] }[], limit = 3): RedditThreadBlock[] {
  const blocks: RedditThreadBlock[] = [];
  for (const item of evidence) {
    for (const post of item.evidence) {
      if (post.platform !== "reddit" || blocks.length >= limit) continue;
      const parsed = redditThreadBlockSchema.safeParse({
        type: "reddit_thread",
        subreddit: post.subreddit?.replace(/^r\//, "") || subredditFromUrl(post.urlCanonical),
        title: (post.title ?? item.title).slice(0, 500),
        url: post.urlCanonical,
        score: typeof post.score === "number" && Number.isFinite(post.score) ? Math.trunc(post.score) : null,
        excerpt: post.contentMd.slice(0, 600),
        comments: (post.existingReplies ?? []).filter((reply) => reply.trim()).slice(0, 3)
          .map((body) => ({ body: body.trim().slice(0, 2000), score: null })),
      });
      if (parsed.success && !blocks.some((block) => block.url === parsed.data.url)) blocks.push(parsed.data);
    }
  }
  return blocks;
}
