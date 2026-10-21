import { z } from "zod";

import { OPPORTUNITY_STATUSES, type OpportunityDetailView } from "@/lib/opportunities/types";

export const gtmAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(12000),
  actions: z.array(z.object({
    prompt: z.string().trim().min(1).max(2000),
    reason: z.string().trim().min(1).max(1000),
  })).length(3).refine((actions) => new Set(actions.map((action) => action.prompt.toLowerCase().replace(/\s+/g, " "))).size === actions.length, {
    message: "Next questions must be distinct",
  }),
});

const evidenceSchema: z.ZodType<OpportunityDetailView> = z.object({
  id: z.string(),
  workspaceId: z.string(),
  status: z.enum(OPPORTUNITY_STATUSES),
  title: z.string(),
  summary: z.string(),
  whyItMatters: z.string(),
  whyNow: z.string(),
  recommendedAction: z.string(),
  confidence: z.number(),
  urgency: z.number(),
  score: z.number(),
  coverage: z.string(),
  features: z.object({
    fit: z.number(), intent: z.number(), evidence: z.number(), momentum: z.number(),
    timing: z.number(), modelConfidence: z.number(), lowConfidence: z.boolean(),
  }),
  evidenceCount: z.number(),
  clusterKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  evidence: z.array(z.object({
    existingReplies: z.array(z.string()).optional(),
    discoveryOnly: z.boolean().optional(),
    documentId: z.string(),
    title: z.string().nullable(),
    urlCanonical: z.string(),
    platform: z.string(),
    contentMd: z.string(),
    postedAt: z.string().nullable(),
    provider: z.string().nullable(),
  })),
});

export const gtmResponseSchema = gtmAnswerSchema.extend({
  conversationId: z.uuid(),
  evidence: z.array(evidenceSchema),
});
