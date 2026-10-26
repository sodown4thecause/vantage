export type ResearchEvidence = {
  id: string;
  url: string;
  retrievedAt: string;
  excerpt: string;
  provider: string;
  contentKind: "full" | "preview";
  status: "verified" | "partial";
};

export type DiscoveryScope = "initial" | "daily_review";
