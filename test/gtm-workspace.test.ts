import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { starterActions, WorkspaceClient } from "@/app/workspace/workspace-client";
import { PRIVATE_PATHS } from "@/lib/seo";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), profile: vi.fn(), queue: vi.fn(), conversation: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize, getCurrentWorkspace: vi.fn() }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: mocks.profile }));
vi.mock("@/lib/opportunities/run", () => ({ listOpportunityQueue: mocks.queue, getOpportunityDetail: mocks.detail }));
vi.mock("@/lib/seo-agent/conversations", () => ({ getConversation: mocks.conversation }));
vi.mock("@/app/source-controls", () => ({ ScanButton: () => null }));

describe("guided GTM workspace", () => {
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
    const { default: Page } = await import("@/app/workspace/page");
    await Page({ searchParams: Promise.resolve({ workspaceId: "foreign-workspace" }) });
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.conversation).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("scopes profile, queue, conversation and detail reads to the authorized workspace", async () => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ ok: true, userId: "owner" });
    mocks.profile.mockResolvedValue(null);
    mocks.queue.mockResolvedValue([{ id: "lead-1" }]);
    mocks.conversation.mockResolvedValue(null);
    mocks.detail.mockResolvedValue(null);
    const { default: Page } = await import("@/app/workspace/page");
    const id = "11111111-1111-4111-8111-111111111111";
    await Page({ searchParams: Promise.resolve({ workspaceId: "owned-workspace", c: id }) });
    expect(mocks.profile).toHaveBeenCalledWith("owned-workspace");
    expect(mocks.queue).toHaveBeenCalledWith({ workspaceId: "owned-workspace", limit: 5 });
    expect(mocks.conversation).toHaveBeenCalledWith("owned-workspace", id);
    expect(mocks.detail).toHaveBeenCalledWith({ workspaceId: "owned-workspace", opportunityId: "lead-1" });
  });
});
