import { z } from "zod";

export const contentFormatValues = [
  "blog_outline",
  "blog_post",
  "x_thread",
  "linkedin_post",
  "reddit_reply",
  "hn_reply",
  "newsletter_section",
] as const;
export type ContentDraftFormat = (typeof contentFormatValues)[number];

export const contentChatRequestSchema = z.object({
  workspaceId: z.uuid(),
  threadId: z.uuid().optional(),
  message: z.string().trim().min(1).max(4000),
  retry: z.boolean().optional(),
});
export type ContentChatRequest = z.infer<typeof contentChatRequestSchema>;

export const contentDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(24000),
  format: z.enum(contentFormatValues),
});
export type ContentDraftInput = z.infer<typeof contentDraftInputSchema>;

export type ContentMessageRole = "user" | "assistant";
export type ContentMessageStatus = "streaming" | "complete" | "incomplete" | "failed";

export function contentThreadTitle(message: string): string {
  const title = message.trim().replace(/\s+/g, " ").slice(0, 80);
  return title || "New content draft";
}
