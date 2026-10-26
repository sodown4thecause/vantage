import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), get: vi.fn(), create: vi.fn(), appendTurn: vi.fn(), appendMessage: vi.fn(),
  consume: vi.fn(), release: vi.fn(), profile: vi.fn(), queue: vi.fn(), answer: vi.fn(), claim: vi.fn(),
}));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize }));
vi.mock("@/lib/plans/limits", () => ({ consume: mocks.consume, release: mocks.release }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: mocks.profile }));
vi.mock("@/lib/opportunities/run", () => ({ listOpportunityQueue: mocks.queue, getOpportunityDetail: vi.fn() }));
vi.mock("@/lib/gtm/answer", () => ({ loadGtmEvidence: mocks.answer }));
vi.mock("@/lib/seo-agent/models", () => ({ seoModels: () => ({ executor: "test" }) }));
vi.mock("@/lib/seo-agent/conversations", () => ({
  getConversation: mocks.get, createConversation: mocks.create, appendTurn: mocks.appendTurn,
  appendMessage: mocks.appendMessage, claimPlan: mocks.claim, unclaimPlan: vi.fn(),
  ConversationNotFoundError: class extends Error {},
}));

import { POST as gtm } from "@/app/api/gtm/chat/route";
import { POST as research } from "@/app/seo/chat/route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actions = [0, 1, 2].map((index) => ({ prompt: `Next ${index}`, reason: "Reason" }));
const request = (body: object) => new Request("https://contextfor.dev/chat", {
  method: "POST", body: JSON.stringify({ workspaceId, ...body }),
});
const stored = (tool?: string, title = "Chat") => ({
  id: conversationId, title,
  messages: tool ? [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", role: "assistant", content: "Answer", parts: { cards: [{ tool }] } }] : [],
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.consume.mockResolvedValue({ allowed: true });
  mocks.get.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: conversationId });
  mocks.appendTurn.mockResolvedValue({ id: conversationId });
  mocks.queue.mockResolvedValue([]);
  mocks.profile.mockResolvedValue(null);
  mocks.answer.mockResolvedValue({ answer: "Grounded answer", actions });
});

describe("chat lane isolation", () => {
  it.each([
    stored("gtm_journey"), stored("onboarding_interview"),
  ])("rejects foreign-lane research questions and approvals before charging or claiming", async (conversation) => {
    mocks.get.mockResolvedValue(conversation);
    for (const body of [{ message: "Question" }, { approvePlan: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }]) {
      const response = await research(request({ conversationId, ...body }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("uses the shared GTM lane filter before quota or model work", async () => {
    mocks.get.mockResolvedValue(null);
    const response = await gtm(request({ conversationId, message: "Question", requestId: "turn-1", expectedRevision: 0 }));
    expect(response.status).toBe(404);
    expect(mocks.get).toHaveBeenCalledWith(workspaceId, conversationId, "gtm");
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});
