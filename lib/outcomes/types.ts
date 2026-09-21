export const OUTCOME_EVENTS = [
  "useful",
  "not_useful",
  "saved",
  "rejected",
  "acted_on",
  "draft_edit",
  "published_url",
  "utm_click",
  "conversion",
] as const;

export type OutcomeEvent = (typeof OUTCOME_EVENTS)[number];

export type OutcomeView = {
  id: string;
  workspaceId: string;
  opportunityId: string;
  draftId: string | null;
  event: OutcomeEvent;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  createdAt: string;
};

export type NorthStarMetric = {
  /** Qualified Opportunities Acted On per Active Workspace per Week */
  metric: "qoaa_per_active_workspace_per_week";
  weekStartUtc: string;
  weekEndUtc: string;
  actedOnCount: number;
  usefulCount: number;
  notUsefulCount: number;
  opportunitySurfacedEstimate: number;
  precision: number | null;
  actionRate: number | null;
};
