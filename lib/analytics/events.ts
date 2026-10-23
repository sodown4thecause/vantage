/**
 * The PostHog funnel (Vantage plan, section 3). Event names are the wire format, so never rename one: PostHog treats
 * a new name as a new event and the funnel history splits.
 *
 * Wired now: signed_up, profile_confirmed, checkout_started, subscribed. The rest are declared so their properties are
 * agreed before the call sites exist.
 */
export const FunnelEvent = {
  SignedUp: "signed_up",
  ProfileUrlSubmitted: "profile_url_submitted",
  ProfileConfirmed: "profile_confirmed",
  FirstScanStarted: "first_scan_started",
  FirstScanCompleted: "first_scan_completed",
  OpportunityOpened: "opportunity_opened",
  ReplyCopied: "reply_copied",
  PublishedUrlAdded: "published_url_added",
  DigestSent: "digest_sent",
  DigestClicked: "digest_clicked",
  CheckoutStarted: "checkout_started",
  Subscribed: "subscribed",
  AgentQuestion: "agent_question",
} as const;

export type FunnelEventName = (typeof FunnelEvent)[keyof typeof FunnelEvent];

/** Properties per event. Never put an email address, profile text or any other free text here. */
export type FunnelEventProperties = {
  signed_up: Record<string, never>;
  profile_url_submitted: Record<string, never>;
  profile_confirmed: { source: "interview" | "form" };
  first_scan_started: Record<string, never>;
  first_scan_completed: { read: number; relevant: number; picked: number };
  opportunity_opened: { from: "email" | "app" };
  reply_copied: Record<string, never>;
  published_url_added: Record<string, never>;
  digest_sent: Record<string, never>;
  digest_clicked: Record<string, never>;
  checkout_started: { plan: string };
  subscribed: { product_id?: string };
  agent_question: { lane: string; credits: number; cost_usd: number };
};
