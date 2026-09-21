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
  documentId: string;
  title: string | null;
  urlCanonical: string;
  platform: string;
  contentMd: string;
  postedAt: string | null;
  provider: string | null;
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
  top: OpportunityCardView[];
};
