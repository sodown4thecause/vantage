import type { EvidenceContentKind } from "@/lib/opportunities/content-kind";

export const OPPORTUNITY_STATUSES = [
  "ignore",
  "monitor",
  "opportunity",
  "review",
] as const;

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export type OpportunityFeatures = {
  fit: number;
  intent: number;
  evidence: number;
  momentum: number;
  timing: number;
  modelConfidence: number;
  lowConfidence: boolean;
};

export type OpportunityEvidenceView = {
  existingReplies?: string[];
  discoveryOnly?: boolean;
  documentId: string;
  title: string | null;
  urlCanonical: string;
  platform: string;
  contentMd: string;
  postedAt: string | null;
  provider: string | null;
  /** How much of the source was read: a search snippet, a page excerpt or the full thread. */
  contentKind?: EvidenceContentKind | null;
  /** Reddit only: the post's score and subreddit when the collector supplied them. */
  score?: number | null;
  subreddit?: string | null;
};

export type OpportunityCardView = {
  id: string;
  workspaceId: string;
  status: OpportunityStatus;
  title: string;
  summary: string;
  whyItMatters: string;
  whyNow: string;
  recommendedAction: string;
  confidence: number;
  urgency: number;
  score: number;
  coverage: string;
  features: OpportunityFeatures;
  evidenceCount: number;
  clusterKey: string;
  createdAt: string;
  updatedAt: string;
};

export type OpportunityDetailView = OpportunityCardView & {
  evidence: OpportunityEvidenceView[];
};

export type BuildOpportunitiesResult = {
  scanned: number;
  clusters: number;
  upserted: number;
  relevant?: number;
  top: OpportunityCardView[];
  /** "budget_limited" when the plan's daily scored-lead cap stopped new leads. */
  coverage?: "budget_limited";
  /** New leads skipped because the daily cap was reached. */
  budgetLimited?: number;
};
