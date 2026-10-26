import { z } from "zod";

import { isPublicHttpUrl } from "@/lib/http/public-fetch";

/*
 * Typed proposals. An agent only ever produces these; it never writes to the database. Server actions apply a
 * proposal after the owner confirms it (profile, competitor, keyword) or after it passes the source quality gate
 * (source). Each shape is exported as a Zod schema and a type, and `proposalToolResultSchema` is the tool-result
 * union that workspace UIs switch on (`kind`, then `status`) to render cards.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const evidenceUrl = z.string().trim().url().max(2000).refine(isPublicHttpUrl, "A public HTTP(S) evidence link is required.");

const bareDomain = z.string().trim().toLowerCase()
  .transform((value) => value.replace(/^www\./, ""))
  .pipe(z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/));

export const PRICING_TIERS = ["free", "freemium", "paid", "enterprise", "unknown"] as const;
export const KEYWORD_KINDS = ["product", "competitor", "category"] as const;
export const PROPOSABLE_SOURCE_TYPES = ["hn", "reddit", "web_search"] as const;

export const profileProposalSchema = z.object({
  productName: text(120),
  description: text(500),
  category: text(160),
  audience: text(300),
  pricingTier: z.enum(PRICING_TIERS),
  differentiators: z.array(text(200)).min(1).max(6),
  evidenceUrl,
}).strict();

export const competitorProposalSchema = z.object({
  domain: bareDomain,
  positioning: text(240),
  evidenceUrl,
}).strict();

export const keywordProposalSchema = z.object({
  keyword: z.string().trim().min(2).max(100),
  kind: z.enum(KEYWORD_KINDS),
  rationale: text(300),
  evidenceUrl,
}).strict();

export const sourceProposalSchema = z.object({
  sourceType: z.enum(PROPOSABLE_SOURCE_TYPES),
  name: text(120),
  queries: z.array(z.string().trim().min(2).max(80)).min(1).max(5),
  rationale: text(300),
  /** The model's own 0 to 1 score. The quality gate treats it as one input, never as the decision. */
  relevanceScore: z.number().min(0).max(1),
  evidenceUrl: evidenceUrl.optional(),
}).strict();

export type ProfileProposal = z.infer<typeof profileProposalSchema>;
export type CompetitorProposal = z.infer<typeof competitorProposalSchema>;
export type KeywordProposal = z.infer<typeof keywordProposalSchema>;
export type SourceProposal = z.infer<typeof sourceProposalSchema>;

export const sourceReviewSchema = z.object({
  accepted: z.boolean(),
  /** 0 to 1, rounded to two places. */
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  matchedTerms: z.array(z.string()),
  /** Plain-English reasons, shown to the owner under "proposed sources (reviewed)". */
  reasons: z.array(z.string()),
}).strict();
export type SourceReview = z.infer<typeof sourceReviewSchema>;

/** Why a proposal did not become a card. Duplicates and limits are not errors; the agent is told and moves on. */
const skipped = (kind: "profile" | "competitor" | "keyword") => z.object({
  kind: z.literal(kind),
  status: z.enum(["duplicate", "limit_reached"]),
  reason: z.string(),
}).strict();

export const proposalToolResultSchema = z.union([
  z.object({ kind: z.literal("profile"), status: z.literal("proposed"), proposal: profileProposalSchema }).strict(),
  z.object({ kind: z.literal("competitor"), status: z.literal("proposed"), proposal: competitorProposalSchema }).strict(),
  z.object({ kind: z.literal("keyword"), status: z.literal("proposed"), proposal: keywordProposalSchema }).strict(),
  z.object({ kind: z.literal("source"), status: z.enum(["proposed", "rejected"]), proposal: sourceProposalSchema, review: sourceReviewSchema }).strict(),
  skipped("profile"), skipped("competitor"), skipped("keyword"),
  z.object({ kind: z.literal("source"), status: z.enum(["duplicate", "limit_reached"]), reason: z.string() }).strict(),
]);
export type ProposalToolResult = z.infer<typeof proposalToolResultSchema>;
