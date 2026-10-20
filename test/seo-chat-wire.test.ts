import { describe, expect, it } from "vitest";

import {
  buildRequestBody,
  fromHistory,
  textOf,
  viewOf,
  type ChatMessage,
  type HistoryMessage,
} from "@/app/seo/chat-wire";

const WS = "11111111-1111-4111-8111-111111111111";
const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MSG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PLAN = [{ tool: "keyword_ideas", input: { keywords: ["ci caching"] }, credits: 1 }];

const user = (text: string): ChatMessage => ({ id: `u-${text}`, role: "user", parts: [{ type: "text", text }] });
const assistant = (text: string): ChatMessage => ({ id: `a-${text}`, role: "assistant", parts: [{ type: "text", text }] });

describe("buildRequestBody", () => {
  it("sends the last user message's text as the question", () => {
    const body = buildRequestBody({
      workspaceId: WS,
      conversationId: CONV,
      messages: [user("first question"), assistant("first answer"), user("second question")],
      body: undefined,
    });
    expect(body).toEqual({ workspaceId: WS, conversationId: CONV, message: "second question" });
  });

  it("sends an empty message when there is no user message to send", () => {
    expect(buildRequestBody({ workspaceId: WS, messages: [assistant("hi")], body: undefined })).toEqual({
      workspaceId: WS,
      conversationId: undefined,
      message: "",
    });
  });

  it("sends approvePlan and no message when the request carries an approval, which wins over a message", () => {
    const body = buildRequestBody({
      workspaceId: WS,
      conversationId: CONV,
      messages: [user("Run the planned lookups")],
      body: { approvePlan: MSG, conversationId: CONV },
    });
    expect(body).toEqual({ workspaceId: WS, conversationId: CONV, approvePlan: MSG });
    expect(body).not.toHaveProperty("message");
  });

  it("passes the conversation id through to the request", () => {
    const body = buildRequestBody({ workspaceId: WS, conversationId: CONV, messages: [user("q")], body: undefined });
    expect(body.conversationId).toBe(CONV);
    expect(buildRequestBody({ workspaceId: WS, messages: [user("q")], body: undefined }).conversationId).toBeUndefined();
  });
});

describe("textOf", () => {
  it("joins text from separate parts with a blank line, and skips non-text parts", () => {
    const message: ChatMessage = {
      id: "m",
      role: "assistant",
      parts: [
        { type: "text", text: "Let me check." },
        { type: "text", text: "Here is the answer." },
      ],
    };
    expect(textOf(message)).toBe("Let me check.\n\nHere is the answer.");
  });
});

describe("viewOf", () => {
  it("reads a streamed answer's parts from its metadata", () => {
    const streamed: ChatMessage = {
      id: "m",
      role: "assistant",
      parts: [{ type: "text", text: "I need approval to run that." }],
      metadata: {
        conversationId: CONV,
        messageId: MSG,
        status: "needs_approval",
        creditsUsed: 0,
        plan: PLAN,
        followUps: { seo: "a", geo: "b", content: "c" },
        notices: ["SEO data is not set up yet."],
      },
    };
    expect(viewOf(streamed)).toEqual({
      messageId: MSG,
      status: "needs_approval",
      creditsUsed: 0,
      text: "I need approval to run that.",
      cards: [],
      followUps: { seo: "a", geo: "b", content: "c" },
      plan: PLAN,
      notices: ["SEO data is not set up yet."],
    });
  });

  it("reads a stored answer's parts from metadata.parts, with an incomplete status", () => {
    const stored = fromHistory({
      id: MSG,
      role: "assistant",
      content: "Partial",
      parts: { plan: [], notices: ["Lookups paused."] },
      status: "incomplete",
      creditsUsed: 2,
      createdAt: "2026-10-19T12:00:00.000Z",
    });
    expect(viewOf(stored)).toMatchObject({
      messageId: MSG,
      status: "incomplete",
      creditsUsed: 2,
      text: "Partial",
      plan: [],
      notices: ["Lookups paused."],
    });
  });

  it("keeps a stored plan and its message id so the owner can run it", () => {
    const stored = fromHistory({
      id: MSG,
      role: "assistant",
      content: "Plan ready.",
      parts: { plan: PLAN },
      status: "needs_approval",
      creditsUsed: 0,
      createdAt: "2026-10-19T12:00:00.000Z",
    });
    const view = viewOf(stored);
    expect(view.status).toBe("needs_approval");
    expect(view.messageId).toBe(MSG);
    expect(view.plan).toEqual(PLAN);
  });

  it("defaults to a complete, empty view for a message with no metadata", () => {
    expect(viewOf({ id: "m", role: "assistant", parts: [] })).toEqual({
      messageId: undefined,
      status: "complete",
      creditsUsed: 0,
      text: "",
      cards: [],
      followUps: undefined,
      plan: [],
      notices: [],
    });
  });
});

describe("fromHistory (metadata merge)", () => {
  const row: HistoryMessage = {
    id: MSG,
    role: "assistant",
    content: "Stored answer.",
    parts: { cards: [], followUps: { seo: "a", geo: "b", content: "c" } },
    status: "complete",
    creditsUsed: 1,
    createdAt: "2026-10-19T12:00:00.000Z",
  };

  it("turns a stored row into a message with its text and its stored parts under metadata", () => {
    expect(fromHistory(row)).toEqual({
      id: MSG,
      role: "assistant",
      parts: [{ type: "text", text: "Stored answer." }],
      metadata: { messageId: MSG, status: "complete", creditsUsed: 1, parts: row.parts },
    });
  });

  it("has no text part for a row with empty content", () => {
    expect(fromHistory({ ...row, content: "" }).parts).toEqual([]);
  });
});
