import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AbstractChat, type ChatState, type ChatTransport } from "ai";

import { nextSend, reconcileSend, starterActions, WorkspaceClient, WorkspaceRequestError, workspaceErrorCopy } from "@/app/workspace/workspace-client";
import { GtmChatParts } from "@/components/gtm-chat-parts";
import type { GtmUIMessage } from "@/lib/gtm/chat/types";
import { PRIVATE_PATHS } from "@/lib/seo";
import Page from "@/app/workspace/page";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), profile: vi.fn(), queue: vi.fn(), conversation: vi.fn(), detail: vi.fn(), conversations: vi.fn(async () => []), saved: vi.fn(async () => []) }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize, getCurrentWorkspace: vi.fn() }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: mocks.profile }));
vi.mock("@/lib/opportunities/run", () => ({ listOpportunityQueue: mocks.queue, getOpportunityDetail: mocks.detail }));
vi.mock("@/lib/seo-agent/conversations", () => ({ getConversation: mocks.conversation, listConversations: mocks.conversations }));
vi.mock("@/lib/workspace/saved-artifacts", () => ({ listSavedArtifacts: mocks.saved }));
vi.mock("@/app/source-controls", () => ({ ScanButton: () => null }));

describe("guided GTM workspace", () => {
  it.each(["missing", "unavailable", "later turn"])("reconciles a granted scan after SDK onError and %s recovery GET", async outcome => {
    const first = nextSend(null, "Scan my confirmed sources", null, [], 0, false, 0, true)!;
    let pending: typeof first | null = first;
    const bodies: unknown[] = [];
    let accepted = 0, errorCalls = 0;
    let recoveryDone!: () => void;
    const recovered = new Promise<void>(resolve => { recoveryDone = resolve; });
    const get = vi.fn(async (url: string) => {
      expect(url).toContain(`requestId=${first.requestId}`);
      if (outcome === "unavailable") throw new TypeError("network");
      if (outcome === "later turn") return Response.json({ revision: 4, turn: { requestId: "tab-b", state: "complete" },
        requestedTurn: { requestId: first.requestId, state: "complete" }, messages: [
          { id: "a-user", role: "user", parts: [{ type: "text", text: first.text }] },
          { id: "b-user", role: "user", parts: [{ type: "text", text: "Later question" }] },
        ] });
      return new Response(null, { status: 404 });
    });
    const state: ChatState<GtmUIMessage> = {
      status: "ready", error: undefined, messages: [],
      pushMessage(message) { this.messages.push(message); }, popMessage() { this.messages.pop(); },
      replaceMessage(index, message) { this.messages[index] = message; }, snapshot(value) { return value; },
    };
    class TestChat extends AbstractChat<GtmUIMessage> {}
    const transport: ChatTransport<GtmUIMessage> = {
      sendMessages: async ({ body }) => {
        bodies.push(body);
        if (outcome === "later turn" ? bodies.length === 1 : bodies.length === 2) accepted++;
        throw new TypeError("network");
      },
      reconnectToStream: async () => null,
    };
    const chat = new TestChat({ id: "test", state, transport, onError: () => {
      if (++errorCalls !== 1) return;
      void get(`/api/gtm/chat?${new URLSearchParams({ workspaceId: "workspace", conversationId: first.conversationId, requestId: first.requestId })}`)
        .then(async response => {
          if (!response.ok) return;
          const data = await response.json();
          if (pending && reconcileSend(pending, data.revision, data.requestedTurn) === "saved") {
            pending = null;
            state.messages = data.messages;
          }
        }).catch(() => {}).finally(recoveryDone);
    } });
    const body = (pending: typeof first) => ({ workspaceId: "workspace", conversationId: pending.conversationId,
      requestId: pending.requestId, expectedRevision: pending.expectedRevision, message: pending.text, create: pending.create, scanRequested: pending.scanRequested });
    await chat.sendMessage({ text: first.text }, { body: body(first) });
    await recovered;
    expect(errorCalls).toBe(1);
    expect(get).toHaveBeenCalledWith(expect.stringContaining(`requestId=${first.requestId}`));
    if (outcome === "later turn") {
      expect(pending).toBeNull();
      expect(state.messages).toHaveLength(2);
      expect(bodies).toEqual([body(first)]);
      expect(accepted).toBe(1);
      expect(nextSend(null, "New question", first.conversationId, state.messages, 1, true, 4, false)?.requestId).not.toBe(first.requestId);
      return;
    }
    const retry = nextSend(first, first.text, first.conversationId, state.messages, 1, false, 9, false)!;
    state.messages = [];
    await chat.sendMessage({ text: retry.text }, { body: body(retry) });
    expect(bodies).toEqual([body(first), body(first)]);
    expect(accepted).toBe(1);
    expect(retry.scanRequested).toBe(true);
    expect(retry.expectedRevision).toBe(0);
  });
  it("reconciles A's receipt when a second tab's later turn is the latest", () => {
    const first = nextSend(null, "Help me find buyers", "conversation", [], 0, true, 2, false)!;
    expect(reconcileSend(first, 6, { requestId: first.requestId })).toBe("saved");
    expect(reconcileSend(first, 6, null)).toBe("changed");
  });
  it("retries a first message after pre-creation transport failure with the same request and creation identity", () => {
    const first = nextSend(null, "Help me find buyers", null, [], 0, true, 0, false)!;
    expect(first.create).toBe(true);
    const retry = nextSend(first, "Help me find buyers", first.conversationId, [], 0, true, 5, false)!;
    expect(retry).toBe(first);
    expect(retry.requestId).toBe(first.requestId);
    expect(retry.conversationId).toBe(first.conversationId);
    expect(nextSend(first, "A newly typed question", first.conversationId, [], 1, false, 5, false)).toBeNull();
    expect(reconcileSend(first, 0, null)).toBe("retry"); // The conversation exists, but the original turn is still unclaimed.
    expect(nextSend(first, first.text, first.conversationId, [], 0, true, 5, false)?.create).toBe(true);
  });
  it("blocks proposal confirmation until the confirmed before-state is available", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const message = { id, role: "assistant", parts: [{ type: "data-proposal", data: {
      id, workspaceId: id, conversationId: id, strategyVersion: 1, payload: { keywords: ["buyers", "operators", "founders"] },
      payloadHash: "a".repeat(64), expiresAt: "2026-11-01T00:00:00.000Z", status: "pending",
    } }] } as GtmUIMessage;
    const html = renderToStaticMarkup(createElement(GtmChatParts, { message, workspaceId: id }));
    expect(html).toContain("Loading confirmed state…");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm changes<\/button>/);
  });
  it.each([new TypeError("Failed to fetch private browser details"), new SyntaxError("Unexpected token from upstream response"), new Error("Internal browser failure"), null])("hides unexpected network and JSON errors (%s)", (error) => {
    expect(workspaceErrorCopy(error)).toBe("That didn’t work. Try again.");
  });

  it("preserves the deliberate workspace error copy", () => {
    const copy = "Unable to access this workspace. Sign in again to continue.";
    expect(workspaceErrorCopy(new WorkspaceRequestError(copy))).toBe(copy);
  });
  it("reopens saved GTM chats in the workspace rather than research", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceClient, {
      workspaceId: "workspace-1", productName: "Example", hasProfile: true,
      initialEvidence: [], configured: true, initialConversationId: "chat-1",
      conversations: [{ id: "chat-1", title: "GTM next steps" }],
    }));
    expect(html).toContain('aria-current="page" href="/workspace?workspaceId=workspace-1&amp;c=chat-1"');
    expect(html).toContain("GTM next steps");
  });
  it.each([[false, false], [true, false], [true, true]])("always offers three contextual starting actions (%s, %s)", (profile, leads) => {
    const actions = starterActions(profile, leads);
    expect(actions).toHaveLength(3);
    expect(new Set(actions.map((action) => action.prompt)).size).toBe(3);
    expect(actions.every((action) => action.reason.length > 0)).toBe(true);
  });

  it("renders a labelled bottom composer, three options and evidence empty state without faking setup", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceClient, {
      workspaceId: "workspace-1", productName: "Example", hasProfile: false,
      initialEvidence: [], configured: false,
    }));
    expect(html).toContain('aria-label="Ask your GTM assistant"');
    expect(html).toContain('aria-label="Recommended next actions"');
    expect(html.match(/Recommended<\/span>/g)).toHaveLength(1);
    expect(html).toContain("No current opportunities yet");
    expect(html).toContain('value="0"');
    expect(html).toContain("AI Gateway connection");
    expect(html).toContain("shared SEO assistant question allowance");
  });

  it("keeps private workspace surfaces out of search", () => {
    expect(PRIVATE_PATHS).toContain("/workspace");
  });

  it("does not read workspace data when authorization fails", async () => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ ok: false, status: 403 });
    await Page({ searchParams: Promise.resolve({ workspaceId: "foreign-workspace" }) });
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.conversation).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.conversations).not.toHaveBeenCalled();
    expect(mocks.saved).not.toHaveBeenCalled();
  });

  it("scopes profile, queue, conversation and detail reads to the authorized workspace", async () => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ ok: true, userId: "owner" });
    mocks.profile.mockResolvedValue(null);
    mocks.queue.mockResolvedValue([{ id: "lead-1" }]);
    mocks.conversation.mockResolvedValue(null);
    mocks.detail.mockResolvedValue(null);
    const id = "11111111-1111-4111-8111-111111111111";
    await Page({ searchParams: Promise.resolve({ workspaceId: "owned-workspace", c: id }) });
    expect(mocks.profile).toHaveBeenCalledWith("owned-workspace");
    expect(mocks.queue).toHaveBeenCalledWith({ workspaceId: "owned-workspace", limit: 5 });
    expect(mocks.conversation).toHaveBeenCalledWith("owned-workspace", id, "gtm");
    expect(mocks.detail).toHaveBeenCalledWith({ workspaceId: "owned-workspace", opportunityId: "lead-1" });
    expect(mocks.conversations).toHaveBeenCalledWith("owned-workspace", 30, "gtm");
    expect(mocks.saved).toHaveBeenCalledWith("owned-workspace");
  });

  it("uses conversational setup with honest configuration and research gaps instead of mandatory questions", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceClient, {
      workspaceId: "workspace-1", productName: "Your product", hasProfile: false, initialEvidence: [], configured: false,
    }));
    expect(html).toContain("Research gaps");
    expect(html).not.toContain("Question 1 of 7");
    expect(html).toContain('aria-label="Ask your GTM assistant"');
    expect(html).toContain("AI Gateway connection");
    expect(html).not.toContain("/onboarding");
    expect(html).toContain("Nothing is posted on your behalf");
    expect(html).toContain('aria-labelledby="saved-heading"');
  });


  it("lists saved items newest first with their lane and actions", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceClient, {
      workspaceId: "workspace-1", productName: "example.com", hasProfile: true, initialEvidence: [], configured: true,
      savedArtifacts: [
        { id: "a", lane: "seo", title: "Backlinks", blocks: [{ type: "text", text: "x" }], createdAt: "2026-10-20T00:00:00.000Z" },
        { id: "b", lane: "gtm", title: "First reply plan", blocks: [{ type: "text", text: "y" }], createdAt: "2026-10-01T00:00:00.000Z" },
      ],
    }));
    expect(html.indexOf("Backlinks")).toBeLessThan(html.indexOf("First reply plan"));
    expect(html).toContain(">SEO<");
    expect(html).toContain("20 Oct 2026");
    expect(html).toContain("Delete Backlinks");
  });
});
