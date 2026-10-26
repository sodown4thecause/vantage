import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), get: vi.fn(), list: vi.fn(), profile: vi.fn(), resumable: vi.fn(),
  chat: vi.fn(), write: vi.fn(),
}));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize, getCurrentWorkspace: vi.fn() }));
vi.mock("@/lib/seo-agent/conversations", () => ({ getConversation: mocks.get, listConversations: mocks.list }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: mocks.profile }));
vi.mock("@/lib/gtm/chat/store", () => ({ loadGtmChat: mocks.chat, getGtmTurnStatus: async () => null, ensureGtmConversation: mocks.write, appendGtmMessages: mocks.write, claimGtmTurn: mocks.write }));
vi.mock("@/lib/gtm/chat/jobs", () => ({ getGtmConversationJobs: async () => [] }));
vi.mock("@/lib/gtm/proposals/repository", () => ({ getPendingStrategyProposal: async () => null }));
vi.mock("@/lib/onboarding/interview-store", () => ({ findResumableInterview: mocks.resumable }));
vi.mock("@/lib/seo-agent/models", () => ({ seoModels: () => ({ executor: "test" }) }));
vi.mock("@/lib/seo-agent/model-config", () => ({ seoModels: () => ({ executor: "test" }) }));
vi.mock("@/lib/opportunities/run", () => ({ listOpportunityQueue: async () => [], getOpportunityDetail: vi.fn() }));
vi.mock("@/lib/workspace/saved-artifacts", () => ({ listSavedArtifacts: async () => [] }));
vi.mock("@/app/source-controls", () => ({ ScanButton: () => null }));
vi.mock("@/lib/seo-agent/suggestions", () => ({ profileContext: () => ({}), starterChips: () => [], withCacheLabels: async () => [] }));
vi.mock("@/app/seo/chat-client", () => ({ ChatClient: () => <div>Research chat content</div> }));

import SeoPage from "@/app/seo/page";
import WorkspacePage from "@/app/workspace/page";
import { WorkspaceClient } from "@/app/workspace/workspace-client";
import { GtmChatLimitError } from "@/lib/gtm/chat/types";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.get.mockResolvedValue(null);
  mocks.list.mockResolvedValue([]);
  mocks.profile.mockResolvedValue(null);
  mocks.resumable.mockResolvedValue(null);
  mocks.chat.mockResolvedValue({ messages: [], revision: 0 });
});

describe("conversation page lanes", () => {
  it("loads only research history and opens a clean chat for a direct foreign-lane URL", async () => {
    const page = await SeoPage({ searchParams: Promise.resolve({ workspaceId, c: conversationId }) });
    const html = renderToStaticMarkup(page);
    expect(mocks.list).toHaveBeenCalledWith(workspaceId, 30, "research");
    expect(mocks.get).toHaveBeenCalledWith(workspaceId, conversationId, "research");
    expect(html).not.toContain("gtm_journey");
    expect(html).toContain("Research chat content");
  });

  it("loads GTM history and reopens history links in the workspace, never research", async () => {
    mocks.list.mockResolvedValue([{ id: conversationId, title: "GTM history", updatedAt: "2026-10-20T00:00:00.000Z" }]);
    const page = await WorkspacePage({ searchParams: Promise.resolve({ workspaceId }) });
    const html = renderToStaticMarkup(page);
    expect(mocks.list).toHaveBeenCalledWith(workspaceId, 30, "gtm");
    expect(html).toContain(`/workspace?workspaceId=${workspaceId}&amp;c=${conversationId}`);
    expect(html).toContain("GTM history");
    expect(html).not.toContain(`/seo?workspaceId=${workspaceId}&amp;c=${conversationId}`);
  });

  it("keeps confirmed state visible and offers conversational setup instead of reopening the fixed interview", async () => {
    mocks.profile.mockResolvedValue({ productUrl: "https://example.com", targetCustomer: "Founders" });
    mocks.resumable.mockResolvedValue({ id: conversationId, state: { answers: {}, complete: false }, turns: [] });
    const page = await WorkspacePage({ searchParams: Promise.resolve({ workspaceId, setup: "1" }) });
    expect(page.props.setupOpen).toBe(true);
    expect(page.props.profile.targetCustomer).toBe("Founders");
    expect(mocks.resumable).not.toHaveBeenCalled();
  });

  it("keeps an explicitly selected GTM conversation open instead of the incomplete interview", async () => {
    mocks.profile.mockResolvedValue({ productUrl: "https://example.com", targetCustomer: "Founders" });
    mocks.resumable.mockResolvedValue({ id: "interview", state: { answers: {}, complete: false }, turns: [] });
    mocks.get.mockResolvedValue({ id: conversationId, title: "GTM", messages: [{ role: "assistant", content: "Answer", parts: { cards: [{ tool: "gtm_journey", data: {} }] } }] });
    const page = await WorkspacePage({ searchParams: Promise.resolve({ workspaceId, c: conversationId }) });
    expect(page.props.setupOpen).toBe(false);
    expect(page.props.initialConversationId).toBe(conversationId);
    expect(mocks.chat).toHaveBeenCalledWith({ workspaceId, conversationId });
  });

  it("offers a scoped new conversation when legacy history exceeds the chat limit without changing it", async () => {
    mocks.get.mockResolvedValue({ id: conversationId, title: "Oversized history" });
    mocks.list.mockResolvedValue([{ id: conversationId, title: "Oversized history" }]);
    mocks.profile.mockResolvedValue({ productUrl: "https://example.com", productDescription: "Confirmed product", targetCustomer: "Founders" });
    mocks.chat.mockRejectedValue(new GtmChatLimitError());

    const page = await WorkspacePage({ searchParams: Promise.resolve({ workspaceId, c: conversationId }) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Conversation history is too large");
    expect(html).toContain(`href="/workspace?workspaceId=${workspaceId}"`);
    expect(html).toContain("New conversation");
    expect(html).toContain("Confirmed product");
    expect(html).toContain("Oversized history");
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("renders a selected GTM history link with the current-page state", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceClient, {
      workspaceId, productName: "Example", hasProfile: true, initialEvidence: [], configured: true,
      initialConversationId: conversationId, conversations: [{ id: conversationId, title: "Selected history" }],
    }));
    expect(html).toMatch(/<a aria-current="page" href="[^"]+">Selected history<\/a>/);
  });
});
