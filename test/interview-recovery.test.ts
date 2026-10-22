import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InterviewState } from "@/lib/onboarding/interview";
import type { MonitoringProfileView } from "@/lib/profile/types";

const mocks = vi.hoisted(() => ({
  current: null as MonitoringProfileView | null,
  state: null as InterviewState | null,
  failCompletion: false,
  writes: 0,
  authorize: vi.fn(),
  save: vi.fn(),
  index: vi.fn(),
  digest: vi.fn(),
  append: vi.fn(),
}));

vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize }));
vi.mock("@/lib/profile/repository", () => ({
  getLatestMonitoringProfile: vi.fn(async () => mocks.current),
  saveMonitoringProfile: mocks.save,
}));
vi.mock("@/lib/profile/index-profile", () => ({ indexSavedProfile: mocks.index }));
vi.mock("@/lib/digest/preferences", () => ({ setDigestHour: mocks.digest }));
vi.mock("@/lib/onboarding/interview-store", () => ({
  loadInterview: vi.fn(async (_workspaceId: string, id: string) => ({ id, state: mocks.state, turns: [] })),
  interviewCard: (state: InterviewState) => ({ tool: "onboarding_interview", title: "Product setup", data: state }),
}));
vi.mock("@/lib/seo-agent/conversations", () => ({
  appendMessage: mocks.append,
  createConversation: vi.fn(),
  ConversationNotFoundError: class extends Error {},
}));

import { POST } from "@/app/api/workspace/interview/route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const request = async (answer = "8am", id = conversationId) => {
  const response = await POST(new Request("http://test/api/workspace/interview", {
    method: "POST", body: JSON.stringify({ workspaceId, conversationId: id, answer, timeZone: "UTC" }),
  }));
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.current = null;
  mocks.failCompletion = false;
  mocks.writes = 0;
  mocks.state = { complete: false, answers: {
    productUrl: "https://example.com/", productDescription: "Tracing for developer tools", targetCustomer: "Developer teams",
    competitors: ["Alpha", "Beta", "Gamma"], communities: [], keywords: ["agent tracing"],
  } };
  mocks.authorize.mockResolvedValue({ ok: true, userId: "owner" });
  mocks.index.mockResolvedValue(undefined);
  mocks.digest.mockResolvedValue(undefined);
  mocks.save.mockImplementation(async ({ input, profileId }) => {
    if (mocks.current?.id === profileId) return mocks.current;
    mocks.writes++;
    mocks.current = { ...input, id: profileId, workspaceId, version: mocks.writes, productMaterialStatus: "ok", productMaterialText: "", retrievalNotes: "", createdAt: "2026-10-22T00:00:00Z" };
    return mocks.current;
  });
  mocks.append.mockImplementation(async (_workspaceId, _conversationId, message) => {
    if (message.role === "assistant") {
      if (mocks.failCompletion && message.content.startsWith("You’re all set")) {
        mocks.failCompletion = false;
        throw new Error("private-upstream-data");
      }
      mocks.state = message.parts.cards[0].data;
    }
    return { id: "message-1" };
  });
});

describe("interview completion recovery", () => {
  it("reuses the saved profile when the completion message fails", async () => {
    mocks.failCompletion = true;
    const failed = await request();
    expect(failed).toEqual({ status: 500, body: { error: "request_failed" } });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const retried = await request("retry");
    expect(retried.body).toMatchObject({ complete: true, profileSaved: true });
    expect(mocks.writes).toBe(1);
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId, profileId: conversationId }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-upstream-data");
  });

  it("reports an unsaved digest honestly and retries without creating another profile", async () => {
    mocks.digest.mockRejectedValueOnce(new Error("private-upstream-data"));
    const failed = await request();
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ complete: false, profileSaved: true });
    expect(failed.body.message).toContain("couldn’t save your chosen digest time");
    expect(failed.body.message).not.toContain("Your daily digest is set for");
    expect(mocks.state?.answers.digest?.hourUtc).toBe(8);
    const retried = await request("retry");
    expect(retried.body.complete).toBe(true);
    expect(retried.body.message).toContain("Your daily digest is set for 8am UTC");
    expect(mocks.writes).toBe(1);
    expect(mocks.digest).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-upstream-data");
  });

  it("still saves the digest when profile indexing fails", async () => {
    mocks.index.mockRejectedValueOnce(new Error("index unavailable"));
    const result = await request();
    expect(result.body.complete).toBe(true);
    expect(mocks.digest).toHaveBeenCalledWith(workspaceId, 8);
  });

  it("does not save again when identical profile fields are already persisted", async () => {
    await request();
    mocks.state!.complete = false;
    await request("retry");
    expect(mocks.writes).toBe(1);
  });

  it("still creates a new version when an input differs from the current profile", async () => {
    await request();
    mocks.state!.complete = false;
    mocks.state!.answers.productDescription = "A different product description";
    await request("retry", "33333333-3333-4333-8333-333333333333");
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.writes).toBe(2);
  });
});
