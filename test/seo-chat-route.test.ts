import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MSG_PLAN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NEW_CONV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RUN_MESSAGE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UPGRADE = "You've used this month's SEO agent questions. Upgrade to Pro for more.";
const ERROR_COPY = "Something went wrong. You weren't charged a question.";
const FOLLOW_UPS = { seo: "Which keywords hold rank?", geo: "Does ChatGPT cite docs?", content: "Outline a comparison post." };

const mocks = vi.hoisted(() => {
  class ConversationNotFoundError extends Error {
    constructor() {
      super("conversation not found");
      this.name = "ConversationNotFoundError";
    }
  }
  return {
    ConversationNotFoundError,
    authorize: vi.fn(),
    consume: vi.fn(),
    release: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    appendMessage: vi.fn(),
    claimPlan: vi.fn(),
    classifyQuestion: vi.fn(),
    runAgent: vi.fn(),
    getLatestMonitoringProfile: vi.fn(),
    unclaimPlan: vi.fn(),
    after: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize }));
vi.mock("@/lib/plans/limits", () => ({ consume: mocks.consume, release: mocks.release }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: mocks.getLatestMonitoringProfile }));
vi.mock("@/lib/seo-agent/classify", () => ({ classifyQuestion: mocks.classifyQuestion }));
vi.mock("@/lib/seo-agent/execute", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo-agent/execute")>()),
  runAgent: mocks.runAgent,
}));
vi.mock("@/lib/seo-agent/conversations", () => ({
  ConversationNotFoundError: mocks.ConversationNotFoundError,
  createConversation: mocks.createConversation,
  getConversation: mocks.getConversation,
  appendMessage: mocks.appendMessage,
  claimPlan: mocks.claimPlan,
  unclaimPlan: mocks.unclaimPlan,
}));

import { POST } from "@/app/seo/chat/route";
import { FAILURE_COPY as FAILURE, REFUSAL_COPY as REFUSAL } from "@/lib/seo-agent/execute";

const PLAN = [{ tool: "keyword_ideas", input: { keywords: ["ci caching"] }, credits: 1 }];
const EXECUTION = { rootMessageId: MSG_PLAN, attemptedEndpoints: 1 };
const CLAIMED = { plan: PLAN, execution: EXECUTION };
const CLASSIFICATION = { intent: "keywords", domains: [], keywords: [], engines: [] };

const storedMessage = (overrides: Record<string, unknown> = {}) => ({
  id: MSG_PLAN,
  role: "assistant",
  content: "Plan ready.",
  parts: { plan: PLAN, execution: EXECUTION },
  status: "needs_approval",
  creditsUsed: 0,
  createdAt: "2026-10-19T12:00:00.000Z",
  ...overrides,
});

function conversation(messages = [storedMessage()]) {
  return { id: CONV, title: "Keywords", messages };
}

/** A fake run that writes `answer` through the real writer and returns `outcome`. */
function fakeRun(outcome: Record<string, unknown> = {}, answer = "Answer.") {
  return {
    messageId: RUN_MESSAGE,
    write: vi.fn(async (writer: { write: (chunk: UIMessageChunk) => void }) => {
      if (answer) {
        writer.write({ type: "text-start", id: "t1" });
        writer.write({ type: "text-delta", id: "t1", delta: answer });
        writer.write({ type: "text-end", id: "t1" });
      }
      return {
        status: "complete",
        content: answer,
        cards: [],
        followUps: FOLLOW_UPS,
        plan: [],
        notices: [],
        creditsUsed: 1,
        execution: { rootMessageId: RUN_MESSAGE, attemptedEndpoints: 0 },
        ...outcome,
      };
    }),
  };
}

function request(body: unknown): Request {
  return new Request("https://contextfor.dev/seo/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Posts and reads the body once: `text` is the raw body, `data` its JSON when the reply is plain JSON. */
async function postAndRead(body: unknown) {
  const res = await POST(request(body));
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return { res, text, data };
}

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-test-key");
  vi.stubEnv("SEO_CLASSIFIER_MODEL", "");
  vi.stubEnv("SEO_AGENT_MODEL", "");
  mocks.authorize.mockReset().mockResolvedValue({ ok: true, userId: "user-1" });
  mocks.consume.mockReset().mockResolvedValue({ allowed: true, limit: 10, used: 1, remaining: 9, consumed: 1 });
  mocks.release.mockReset().mockResolvedValue(undefined);
  mocks.createConversation.mockReset().mockResolvedValue({ id: NEW_CONV });
  mocks.getConversation.mockReset().mockResolvedValue(null);
  mocks.appendMessage.mockReset().mockResolvedValue({ id: "msg-new" });
  mocks.claimPlan.mockReset().mockResolvedValue(null);
  mocks.unclaimPlan.mockReset().mockResolvedValue(true);
  mocks.classifyQuestion.mockReset().mockResolvedValue(CLASSIFICATION);
  mocks.runAgent.mockReset().mockResolvedValue(fakeRun());
  mocks.getLatestMonitoringProfile.mockReset().mockResolvedValue(null);
  mocks.after.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /seo/chat: access and configuration", () => {
  it("answers 403 for a workspace the user does not own, and touches nothing else", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 403, error: "forbidden" });
    const { res, data } = await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(res.status).toBe(403);
    expect(data).toEqual({ error: "forbidden" });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.classifyQuestion).not.toHaveBeenCalled();
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("answers 503 not_configured when the AI Gateway key is missing", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const { res, data } = await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(res.status).toBe(503);
    expect(data).toEqual({ error: "not_configured" });
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("rejects a body with both or neither of message and approvePlan", async () => {
    expect((await postAndRead({ workspaceId: WS })).res.status).toBe(400);
    expect((await postAndRead({ workspaceId: WS, message: "hi", approvePlan: MSG_PLAN })).res.status).toBe(400);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("rejects a blank message or one over 2,000 characters after trimming", async () => {
    expect((await postAndRead({ workspaceId: WS, message: "   " })).res.status).toBe(400);
    expect((await postAndRead({ workspaceId: WS, message: "x".repeat(2001) })).res.status).toBe(400);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body", async () => {
    const res = await POST(new Request("https://contextfor.dev/seo/chat", { method: "POST", body: "{nope" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /seo/chat: asking a question", () => {
  it("continues research whose user-derived title matches the interview title", async () => {
    mocks.getConversation.mockResolvedValue({ ...conversation(), title: "Product setup interview" });
    const { res } = await postAndRead({ workspaceId: WS, conversationId: CONV, message: "Which keywords?" });
    expect(res.status).toBe(200);
    expect(mocks.consume).toHaveBeenCalled();
    expect(mocks.runAgent).toHaveBeenCalled();
  });
  it.each(["gtm_journey", "onboarding_interview"])("rejects %s chats before charging or writing", async (tool) => {
    mocks.getConversation.mockResolvedValue(conversation([storedMessage({ parts: { cards: [{ tool }] } })]));
    const response = await POST(request({ workspaceId: WS, conversationId: CONV, message: "Continue" }));
    expect(response.status).toBe(404);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });
  it("streams the upgrade text without a model call when the monthly questions are used up", async () => {
    mocks.consume.mockResolvedValue({ allowed: false, limit: 10, used: 10, remaining: 0, consumed: 0 });
    const { res, text } = await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(res.status).toBe(200);
    expect(text).toContain(UPGRADE);
    expect(mocks.classifyQuestion).not.toHaveBeenCalled();
    expect(mocks.runAgent).not.toHaveBeenCalled();
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("returns 404 not_found for an unknown or foreign conversation before charging a question", async () => {
    mocks.getConversation.mockResolvedValue(null);
    const { res, data } = await postAndRead({ workspaceId: WS, conversationId: CONV, message: "Which keywords?" });
    expect(res.status).toBe(404);
    expect(data).toEqual({ error: "not_found" });
    expect(mocks.getConversation).toHaveBeenCalledWith(WS, CONV);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.classifyQuestion).not.toHaveBeenCalled();
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("creates a conversation titled with the first 80 characters, then classifies and runs the agent", async () => {
    const message = `Which keywords should we target for ${"x".repeat(120)}`;
    const { res } = await postAndRead({ workspaceId: WS, message: `  ${message}  ` });
    expect(res.status).toBe(200);
    expect(mocks.consume).toHaveBeenCalledWith(WS, "seo_questions_per_month");
    expect(mocks.createConversation).toHaveBeenCalledWith(WS, message.slice(0, 80));
    expect(mocks.appendMessage).toHaveBeenCalledWith(WS, NEW_CONV, { role: "user", content: message });
    expect(mocks.classifyQuestion).toHaveBeenCalledWith(WS, message, expect.any(String), expect.any(Object));
    expect(mocks.runAgent).toHaveBeenCalledTimes(1);
    expect(mocks.runAgent.mock.calls[0]![0]).toMatchObject({ workspaceId: WS, conversationId: NEW_CONV, question: message, classification: CLASSIFICATION });
  });

  it("runs the agent with classification intent all as given, with no approved calls", async () => {
    mocks.classifyQuestion.mockResolvedValue({ intent: "all", domains: [], keywords: [], engines: [] });
    await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    const input = mocks.runAgent.mock.calls[0]![0];
    expect(input.classification.intent).toBe("all");
    expect(input.approved).toBeUndefined();
  });

  it("saves the answer with its parts and status complete", async () => {
    const cards = [{ tool: "keyword_ideas", title: "Keyword ideas", fetchedAt: null, cached: true, data: [] }];
    mocks.runAgent.mockResolvedValue(fakeRun({ cards, notices: ["SEO data is not set up yet."], creditsUsed: 2 }, "Use these keywords."));
    await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(WS, NEW_CONV, {
      id: RUN_MESSAGE,
      role: "assistant",
      content: "Use these keywords.",
      parts: {
        cards,
        followUps: FOLLOW_UPS,
        plan: [],
        notices: ["SEO data is not set up yet."],
        execution: { rootMessageId: RUN_MESSAGE, attemptedEndpoints: 0 },
      },
      status: "complete",
      creditsUsed: 2,
    });
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("saves a produced plan with status needs_approval under the run's message id, so Run it can name it", async () => {
    mocks.runAgent.mockResolvedValue(fakeRun({ plan: PLAN, creditsUsed: 0 }, "I need approval for one call."));
    await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(WS, NEW_CONV, expect.objectContaining({
      id: RUN_MESSAGE,
      status: "needs_approval",
      parts: expect.objectContaining({ plan: PLAN }),
    }));
  });

  it("saves a partial answer as incomplete and keeps the question charged", async () => {
    mocks.runAgent.mockResolvedValue(fakeRun({ status: "incomplete", content: "Partial" }, "Partial"));
    await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(WS, NEW_CONV, expect.objectContaining({ status: "incomplete", content: "Partial" }));
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases the question and saves the error reply as incomplete when the answer fails before any text", async () => {
    mocks.runAgent.mockResolvedValue(fakeRun({ status: "failed", content: "", creditsUsed: 0 }, ERROR_COPY));
    const { text } = await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(text).toContain(ERROR_COPY);
    expect(mocks.release).toHaveBeenCalledWith(WS, "seo_questions_per_month");
    expect(mocks.appendMessage.mock.calls.map((call) => call[2].role)).toEqual(["user", "assistant"]);
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(WS, NEW_CONV, {
      id: RUN_MESSAGE,
      role: "assistant",
      content: FAILURE,
      status: "incomplete",
    });
  });

  it("releases the question and saves the refusal reply as incomplete when the model refuses twice", async () => {
    mocks.runAgent.mockResolvedValue(fakeRun({ status: "refused", content: "" }, REFUSAL));
    const { text } = await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(text).toContain(REFUSAL);
    expect(mocks.release).toHaveBeenCalledWith(WS, "seo_questions_per_month");
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(WS, NEW_CONV, { id: RUN_MESSAGE, role: "assistant", content: REFUSAL, status: "incomplete" });
  });

  it("releases the question and saves the error reply when the agent throws before streaming", async () => {
    mocks.runAgent.mockRejectedValue(new Error("provider down"));
    const { res, text } = await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(res.status).toBe(200);
    expect(text).toContain(ERROR_COPY);
    expect(mocks.release).toHaveBeenCalledWith(WS, "seo_questions_per_month");
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(WS, NEW_CONV, { role: "assistant", content: FAILURE, status: "incomplete" });
  });

  it("releases the question and saves the error reply when the run's stream throws", async () => {
    const run = fakeRun();
    run.write.mockRejectedValue(new Error("stream broke"));
    mocks.runAgent.mockResolvedValue(run);
    const { text } = await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(text).toContain(ERROR_COPY);
    expect(mocks.release).toHaveBeenCalledWith(WS, "seo_questions_per_month");
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(WS, NEW_CONV, {
      id: RUN_MESSAGE,
      role: "assistant",
      content: FAILURE,
      status: "incomplete",
    });
  });

  it("saves no reply when the question itself could not be saved, and still releases the charge", async () => {
    mocks.appendMessage.mockRejectedValueOnce(new Error("db down"));
    const { text } = await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(text).toContain(ERROR_COPY);
    expect(mocks.release).toHaveBeenCalledWith(WS, "seo_questions_per_month");
    expect(mocks.appendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("starts the model history on a user turn when the window begins with an assistant reply", async () => {
    mocks.getConversation.mockResolvedValue(conversation([
      storedMessage({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", role: "assistant", content: "Old reply.", status: "complete", parts: {} }),
      storedMessage({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", role: "user", content: "First question.", status: "complete", parts: {} }),
      storedMessage({ id: "99999999-9999-4999-8999-999999999999", role: "assistant", content: "First answer.", status: "complete", parts: {} }),
    ]));
    await postAndRead({ workspaceId: WS, conversationId: CONV, message: "Second question?" });
    expect(mocks.runAgent.mock.calls[0]![0].history).toEqual([
      { role: "user", content: "First question." },
      { role: "assistant", content: "First answer." },
    ]);
  });

  it("leaves the fixed failure and refusal replies out of the model history, but keeps other incomplete replies", async () => {
    mocks.getConversation.mockResolvedValue(conversation([
      storedMessage({ id: "11111111-aaaa-4aaa-8aaa-111111111111", role: "user", content: "First question.", status: "complete", parts: {} }),
      storedMessage({ id: "22222222-aaaa-4aaa-8aaa-222222222222", role: "assistant", content: ERROR_COPY, status: "incomplete", parts: {} }),
      storedMessage({ id: "33333333-aaaa-4aaa-8aaa-333333333333", role: "user", content: "Second question.", status: "complete", parts: {} }),
      storedMessage({ id: "44444444-aaaa-4aaa-8aaa-444444444444", role: "assistant", content: REFUSAL, status: "incomplete", parts: {} }),
      storedMessage({ id: "55555555-aaaa-4aaa-8aaa-555555555555", role: "user", content: "Third question.", status: "complete", parts: {} }),
      storedMessage({ id: "66666666-aaaa-4aaa-8aaa-666666666666", role: "assistant", content: "Partial answer.", status: "incomplete", parts: {} }),
    ]));
    await postAndRead({ workspaceId: WS, conversationId: CONV, message: "Next question?" });
    expect(mocks.runAgent.mock.calls[0]![0].history).toEqual([
      { role: "user", content: "First question." },
      { role: "user", content: "Second question." },
      { role: "user", content: "Third question." },
      { role: "assistant", content: "Partial answer." },
    ]);
  });

  it("maps a conversation that disappears during the question to 404 and releases the charge", async () => {
    mocks.getConversation.mockResolvedValue(conversation([]));
    mocks.appendMessage.mockRejectedValue(new mocks.ConversationNotFoundError());
    const { res } = await postAndRead({ workspaceId: WS, conversationId: CONV, message: "Which keywords?" });
    expect(res.status).toBe(404);
    expect(mocks.release).toHaveBeenCalledWith(WS, "seo_questions_per_month");
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });
});

describe("POST /seo/chat: approving a plan", () => {
  it("approves research whose user-derived title matches the interview title", async () => {
    mocks.getConversation.mockResolvedValue({ ...conversation(), title: "Product setup interview" });
mocks.claimPlan.mockResolvedValueOnce(CLAIMED);
    const { res } = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(res.status).toBe(200);
    expect(mocks.claimPlan).toHaveBeenCalledWith(WS, MSG_PLAN);
    expect(mocks.runAgent).toHaveBeenCalled();
  });
  it.each(["gtm_journey", "onboarding_interview"])("rejects plan approval in %s chats", async (tool) => {
    mocks.getConversation.mockResolvedValue(conversation([storedMessage({ parts: { cards: [{ tool }], plan: PLAN } })]));
    const response = await POST(request({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN }));
    expect(response.status).toBe(404);
    expect(mocks.claimPlan).not.toHaveBeenCalled();
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });
  it("runs the approved plan once with no new question charge", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValueOnce(CLAIMED);
    const { res } = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(res.status).toBe(200);
    expect(mocks.claimPlan).toHaveBeenCalledWith(WS, MSG_PLAN);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.classifyQuestion).not.toHaveBeenCalled();
    expect(mocks.runAgent.mock.calls[0]![0]).toMatchObject({
      conversationId: CONV,
      approved: PLAN,
      execution: EXECUTION,
    });
  });

  it("answers 409 already_run on the second approval and runs the agent only once", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValueOnce(CLAIMED).mockResolvedValueOnce(null);
    expect((await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN })).res.status).toBe(200);
    const second = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(second.res.status).toBe(409);
    expect(second.data).toEqual({ error: "already_run" });
    expect(mocks.runAgent).toHaveBeenCalledTimes(1);
  });

  it("treats an empty plan as nothing to run", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValue({ plan: [], execution: EXECUTION });
    const { res, data } = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(res.status).toBe(409);
    expect(data).toEqual({ error: "already_run" });
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("answers 404 for a message that is not in the given conversation, before claiming it", async () => {
    mocks.getConversation.mockResolvedValue(conversation([]));
    const { res } = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(res.status).toBe(404);
    expect(mocks.claimPlan).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown conversation and asks for conversationId when it is missing", async () => {
    expect((await postAndRead({ workspaceId: WS, approvePlan: MSG_PLAN })).res.status).toBe(400);
    mocks.getConversation.mockResolvedValue(null);
    expect((await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN })).res.status).toBe(404);
    expect(mocks.claimPlan).not.toHaveBeenCalled();
  });

  it("returns the plan without charging or releasing a question when the approved run fails before any text", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValue(CLAIMED);
    mocks.runAgent.mockResolvedValue(fakeRun({ status: "failed", content: "", creditsUsed: 0 }, ERROR_COPY));
    const { text } = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(text).toContain(ERROR_COPY);
    expect(mocks.unclaimPlan).toHaveBeenCalledWith(WS, MSG_PLAN);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(text).toContain('"planReturned":true');
  });

  it("does not say the plan went back when it was no longer claimed", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValue(CLAIMED);
mocks.unclaimPlan.mockResolvedValue(false);
    mocks.runAgent.mockResolvedValue(fakeRun({ status: "failed", content: "", creditsUsed: 0 }, ERROR_COPY));
    const { text } = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(text).not.toContain("planReturned");
  });

  it("returns the plan when the approved run is refused", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValue(CLAIMED);
    mocks.runAgent.mockResolvedValue(fakeRun({ status: "refused", content: "" }, REFUSAL));
    await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(mocks.unclaimPlan).toHaveBeenCalledWith(WS, MSG_PLAN);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("returns the plan when the approved run's stream throws", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValue(CLAIMED);
    const run = fakeRun();
    run.write.mockRejectedValue(new Error("stream broke"));
    mocks.runAgent.mockResolvedValue(run);
    const { text } = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(text).toContain(ERROR_COPY);
    expect(mocks.unclaimPlan).toHaveBeenCalledWith(WS, MSG_PLAN);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("returns the plan, without charging, when the approved run throws before streaming", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValue(CLAIMED);
    mocks.runAgent.mockRejectedValue(new Error("gateway key missing"));
    const { res, text } = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(res.status).toBe(200);
    expect(text).toContain(ERROR_COPY);
    expect(mocks.unclaimPlan).toHaveBeenCalledWith(WS, MSG_PLAN);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(text).toContain('"planReturned":true');
  });

  it("keeps the plan claimed when the approved run produced a partial answer", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValue(CLAIMED);
    mocks.runAgent.mockResolvedValue(fakeRun({ status: "incomplete", content: "Partial" }, "Partial"));
    const { text } = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(mocks.unclaimPlan).not.toHaveBeenCalled();
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(WS, CONV, expect.objectContaining({ status: "incomplete", content: "Partial" }));
    expect(text).not.toContain("planReturned");
  });

  it("keeps the plan claimed after a successful approved run", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValue(CLAIMED);
    mocks.runAgent.mockResolvedValue(fakeRun({ status: "complete", creditsUsed: 1 }, "Done."));
    await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(mocks.unclaimPlan).not.toHaveBeenCalled();
  });
});

describe("POST /seo/chat: workspace scoping", () => {
  it("authorizes the body's workspace before any read or charge", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 403, error: "forbidden" });
    await postAndRead({ workspaceId: OTHER_WS, conversationId: CONV, message: "Which keywords?" });
    expect(mocks.authorize).toHaveBeenCalledWith(OTHER_WS);
    expect(mocks.getConversation).not.toHaveBeenCalled();
  });
});

describe("POST /seo/chat: settlement outlives the client", () => {
  it("registers the answer's settlement with after() as one promise", async () => {
    mocks.appendMessage.mockClear();
    const { res } = await postAndRead({ workspaceId: WS, message: "Which keywords?" });
    expect(res.status).toBe(200);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    const registered = mocks.after.mock.calls[0]![0];
    expect(registered).toBeInstanceOf(Promise);
    await registered;
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(WS, NEW_CONV, expect.objectContaining({ id: RUN_MESSAGE, status: "complete" }));
  });

  it("still settles the turn when the stream consumer stops reading", async () => {
    const { res } = await (async () => ({ res: await POST(request({ workspaceId: WS, message: "Which keywords?" })) }))();
    expect(res.status).toBe(200);
    await res.body!.cancel();
    await mocks.after.mock.calls[0]![0];
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(WS, NEW_CONV, expect.objectContaining({ id: RUN_MESSAGE, status: "complete" }));
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("registers approved-plan settlement with after() too", async () => {
    mocks.getConversation.mockResolvedValue(conversation());
mocks.claimPlan.mockResolvedValue(CLAIMED);
    const { res } = await postAndRead({ workspaceId: WS, conversationId: CONV, approvePlan: MSG_PLAN });
    expect(res.status).toBe(200);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0]![0];
  });
});
