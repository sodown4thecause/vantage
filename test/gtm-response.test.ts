import { describe, expect, it } from "vitest";

import { gtmResponseSchema } from "@/lib/gtm/schema";

const response = {
  conversationId: "11111111-1111-4111-8111-111111111111",
  answer: "Start with the strongest signal.",
  actions: ["Who should I reach?", "Why now?", "How should I reply?"].map((prompt) => ({ prompt, reason: "Check the evidence." })),
  evidence: [{
    id: "lead-1", workspaceId: "workspace-1", status: "opportunity",
    title: "Looking for a tool", summary: "A buyer needs help.", whyItMatters: "Strong fit.",
    whyNow: "Recent request.", recommendedAction: "Read the source.",
    confidence: 0.9, urgency: 0.8, score: 90, coverage: "complete",
    features: { fit: 1, intent: 1, evidence: 1, momentum: 1, timing: 1, modelConfidence: 1, lowConfidence: false },
    evidenceCount: 1, clusterKey: "cluster-1", createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z",
    evidence: [{ documentId: "post-1", title: null, urlCanonical: "https://example.com/post", platform: "reddit", contentMd: "Can anyone recommend a tool?", postedAt: null, provider: null }],
  }],
};

describe("GTM response validation", () => {
  it("accepts real evidence, nullable source metadata and an empty queue", () => {
    expect(gtmResponseSchema.parse(response)).toEqual(response);
    expect(gtmResponseSchema.safeParse({ ...response, evidence: [] }).success).toBe(true);
  });

  it.each([
    null,
    { ...response, conversationId: "not-a-uuid" },
    { ...response, answer: null },
    { ...response, actions: response.actions.slice(0, 2) },
    { ...response, actions: [response.actions[0], response.actions[0], response.actions[2]] },
    { ...response, actions: [{ prompt: "Question", reason: null }, ...response.actions.slice(1)] },
    { ...response, evidence: null },
    { ...response, evidence: [{ ...response.evidence[0], updatedAt: null }] },
    { ...response, evidence: [{ ...response.evidence[0], evidence: [{ ...response.evidence[0].evidence[0], contentMd: null }] }] },
  ])("rejects malformed data before it can enter client state (%#)", (value) => {
    expect(gtmResponseSchema.safeParse(value).success).toBe(false);
  });
});
