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

export const contentDraftUpdateInputSchema = z.object({
  draftId: z.uuid(),
  title: z.string().min(1).max(120).refine((value) => value.trim().length > 0),
  body: z.string().min(1).max(24_000).refine((value) => value.trim().length > 0),
}).strict();
export type ContentDraftUpdateInput = z.infer<typeof contentDraftUpdateInputSchema>;

export const contentDraftRepurposeInputSchema = z.object({
  draftId: z.uuid(),
  format: z.enum(contentFormatValues),
}).strict();
export type ContentDraftRepurposeInput = z.infer<typeof contentDraftRepurposeInputSchema>;

export const contentChatRequestSchema = z.object({
  workspaceId: z.uuid(),
  threadId: z.uuid().optional(),
  message: z.string().min(1).max(32_000).refine((value) => value.trim().length > 0),
  preserveText: z.boolean().optional(),
  draftUpdate: contentDraftUpdateInputSchema.optional(),
  repurposeDraft: contentDraftRepurposeInputSchema.optional(),
  retry: z.boolean().optional(),
}).superRefine(({ draftUpdate, repurposeDraft, preserveText }, context) => {
  if (draftUpdate && preserveText !== true) {
    context.addIssue({ code: "custom", path: ["draftUpdate"], message: "Exact draft edits must preserve text." });
  }
  if (draftUpdate && repurposeDraft) {
    context.addIssue({ code: "custom", path: ["repurposeDraft"], message: "A draft cannot be saved and repurposed in the same request." });
  }
});
export type ContentChatRequest = z.infer<typeof contentChatRequestSchema>;

export const contentDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(24000),
  format: z.enum(contentFormatValues),
});
export type ContentDraftInput = z.infer<typeof contentDraftInputSchema>;

export const contentBrandVoiceProfileSchema = z.object({
  audience: z.string().trim().min(1).max(600),
  purpose: z.string().trim().min(1).max(800),
  voice: z.string().trim().min(1).max(1600),
  structure: z.string().trim().min(1).max(1200),
  avoid: z.array(z.string().trim().min(1).max(160)).max(24),
  sampleText: z.string().trim().max(12000).optional(),
});
export type ContentBrandVoiceProfile = z.infer<typeof contentBrandVoiceProfileSchema>;

export type ContentMessageRole = "user" | "assistant";
export type ContentMessageStatus = "streaming" | "complete" | "incomplete" | "failed";

export function contentThreadTitle(message: string): string {
  const title = message.trim().replace(/\s+/g, " ").slice(0, 80);
  return title || "New content draft";
}
