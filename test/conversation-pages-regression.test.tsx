import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), get: vi.fn(), list: vi.fn(), profile: vi.fn(), resumable: vi.fn(),
}));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize, getCurrentWorkspace: vi.fn() }));
vi.mock("@/lib/seo-agent/conversations", () => ({ getConversation: mocks.get, listConversations: mocks.list }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: mocks.profile }));
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

const workspaceId = "11111111-1111-4111-8111-111111111111";
const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.get.mockResolvedValue(null);
  mocks.list.mockResolvedValue([]);
  mocks.profile.mockResolvedValue(null);
  mocks.resumable.mockResolvedValue(null);
});

describe("conversation page lanes", () => {
  it("loads only research history and opens a clean chat for a direct foreign-lane URL", async () => {
    const page = await SeoPage({ searchParams: Promise.resolve({ workspaceId, c: conversationId }) });
    const html = renderToStaticMarkup(page);
    expect(mocks.list).toHaveBeenCalledWith(workspaceId, 30, "research");
    expect(mocks.get).toHaveBeenCalledWith(workspaceId, conversationId);
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

  it("resumes an incomplete interview even when the profile has already saved", async () => {
    mocks.profile.mockResolvedValue({ productUrl: "https://example.com", targetCustomer: "Founders" });
    mocks.resumable.mockResolvedValue({ id: conversationId, state: { answers: {}, complete: false }, turns: [] });
    const page = await WorkspacePage({ searchParams: Promise.resolve({ workspaceId }) });
    expect(page.props.interviewOpen).toBe(true);
  });

  it("keeps an explicitly selected GTM conversation open instead of the incomplete interview", async () => {
    mocks.profile.mockResolvedValue({ productUrl: "https://example.com", targetCustomer: "Founders" });
    mocks.resumable.mockResolvedValue({ id: "interview", state: { answers: {}, complete: false }, turns: [] });
    mocks.get.mockResolvedValue({ id: conversationId, title: "GTM", messages: [{ role: "assistant", content: "Answer", parts: { cards: [{ tool: "gtm_journey", data: {} }] } }] });
    const page = await WorkspacePage({ searchParams: Promise.resolve({ workspaceId, c: conversationId }) });
    expect(page.props.interviewOpen).toBe(false);
    expect(page.props.initialConversationId).toBe(conversationId);
  });

  it("renders a selected GTM history link with the current-page state", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceClient, {
      workspaceId, productName: "Example", hasProfile: true, initialEvidence: [], configured: true,
      initialConversationId: conversationId, conversations: [{ id: conversationId, title: "Selected history" }],
    }));
    expect(html).toMatch(/<a aria-current="page" href="[^"]+">Selected history<\/a>/);
  });
});
