export const SAVED_ARTIFACT_LANES = ["gtm", "seo", "geo", "content"] as const;
export type SavedArtifactLane = (typeof SAVED_ARTIFACT_LANES)[number];

export const LANE_LABELS: Record<SavedArtifactLane, string> = { gtm: "GTM", seo: "SEO", geo: "GEO", content: "Content" };
