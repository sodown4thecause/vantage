import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(async () => []) }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: async () => ({ ok: true }), getCurrentWorkspace: vi.fn() }));
vi.mock("@/lib/seo-agent/conversations", () => ({ getConversation: mocks.get, listConversations: mocks.list }));
vi.mock("@/lib/seo-agent/models", () => ({ seoModels: () => ({}) }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: async () => null }));
vi.mock("@/lib/seo-agent/suggestions", () => ({ profileContext: () => ({}), starterChips: () => [], withCacheLabels: async () => [] }));
vi.mock("@/app/seo/chat-client", () => ({ ChatClient: (props: { conversationId: string | null; initialMessages: unknown[] }) => createElement("div", { "data-conversation": props.conversationId ?? "new" }, JSON.stringify(props.initialMessages)) }));

describe("research conversation navigation", () => {
  it.each(["gtm_journey", "onboarding_interview"])("does not reopen a manually selected %s conversation", async (tool) => {
    mocks.get.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", messages: [{ parts: { cards: [{ tool }] } }] });
    const { default: Page } = await import("@/app/seo/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ workspaceId: "workspace-1", c: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) }));
    expect(mocks.list).toHaveBeenCalledWith("workspace-1", 30, "research");
    expect(html).toContain('data-conversation="new"');
    expect(html).not.toContain(tool);
  });
});
