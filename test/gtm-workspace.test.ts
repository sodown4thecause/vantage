import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { starterActions, WorkspaceClient, WorkspaceRequestError, workspaceErrorCopy } from "@/app/workspace/workspace-client";
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
