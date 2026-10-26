import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  currentWorkspace: vi.fn(),
  listThreads: vi.fn(),
  listDrafts: vi.fn(),
  getThread: vi.fn(),
  getBrandVoice: vi.fn(),
  listOpportunities: vi.fn(),
  getMonitoringProfile: vi.fn(),
}));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: mocks.authorize,
  getCurrentWorkspace: mocks.currentWorkspace,
}));
vi.mock("@/lib/content-agent/repository", () => ({
  getContentBrandVoiceProfile: mocks.getBrandVoice,
  getContentThread: mocks.getThread,
  listContentDrafts: mocks.listDrafts,
  listContentThreads: mocks.listThreads,
}));
vi.mock("@/lib/opportunities/run", () => ({ listOpportunityQueue: mocks.listOpportunities }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: mocks.getMonitoringProfile }));
vi.mock("@/app/content/content-workspace-client", () => ({ ContentWorkspaceClient: () => null }));

import ContentPage from "@/app/content/page";
import {
  FALLBACK_SUGGESTED_PROMPTS,
  SuggestedPrompts,
  buildSuggestedPrompts,
} from "@/app/content/suggested-prompts";
import type { OpportunityCardView } from "@/lib/opportunities/types";
import type { MonitoringProfileView } from "@/lib/profile/types";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";

function opportunity(id: string, workspaceId: string, score: number, title: string): OpportunityCardView {
  return {
    id,
    workspaceId,
    status: "opportunity",
    title,
    summary: `Summary for ${title}`,
    whyItMatters: "A useful customer insight.",
    whyNow: "The discussion is timely.",
    recommendedAction: "Respond with a practical point.",
    confidence: 0.9,
    urgency: 0.8,
    score,
    coverage: "full",
    features: { fit: 0.9, intent: 0.8, evidence: 0.9, momentum: 0.8, timing: 0.7, modelConfidence: 0.9, lowConfidence: false },
    evidenceCount: 1,
    clusterKey: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function profile(workspaceId: string, topics = ["customer onboarding", "retention", "product analytics"]): MonitoringProfileView {
  return {
    id: `profile-${workspaceId}`,
    workspaceId,
    version: 4,
    productUrl: "https://example.com",
    docsUrls: [],
    productDescription: "A practical product for growing teams.",
    targetCustomer: "Australian SaaS founders",
    competitors: [],
    topics,
    productMaterialStatus: "ok",
    productMaterialText: "",
    retrievalNotes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("Content suggested prompts", () => {
  it("builds three deterministic prompts from the top current opportunities and keyword profile", () => {
    const prompts = buildSuggestedPrompts({
      workspaceId: WORKSPACE,
      opportunities: [
        opportunity("top", WORKSPACE, 90, "Reducing onboarding drop-off"),
        opportunity("second", WORKSPACE, 70, "Improving trial conversion"),
        opportunity("third", WORKSPACE, 50, "Understanding product adoption"),
      ],
      profile: profile(WORKSPACE),
    });

    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain("Reducing onboarding drop-off");
    expect(prompts[0]).toContain("customer onboarding");
    expect(prompts[1]).toContain("Improving trial conversion");
    expect(prompts[1]).toContain("retention");
    expect(prompts[2]).toContain("Understanding product adoption");
    expect(prompts.every((prompt) => prompt.includes("Australian English"))).toBe(true);
    expect(buildSuggestedPrompts({
      workspaceId: WORKSPACE,
      opportunities: [
        opportunity("top", WORKSPACE, 90, "Reducing onboarding drop-off"),
        opportunity("second", WORKSPACE, 70, "Improving trial conversion"),
        opportunity("third", WORKSPACE, 50, "Understanding product adoption"),
      ],
      profile: profile(WORKSPACE),
    })).toEqual(prompts);
  });

  it("uses the static fallback if either source is unavailable", () => {
    expect(buildSuggestedPrompts({ workspaceId: WORKSPACE, opportunities: [], profile: profile(WORKSPACE) }))
      .toEqual(FALLBACK_SUGGESTED_PROMPTS);
    expect(buildSuggestedPrompts({
      workspaceId: WORKSPACE,
      opportunities: [opportunity("top", WORKSPACE, 90, "A current opportunity")],
      profile: null,
    })).toEqual(FALLBACK_SUGGESTED_PROMPTS);
    expect(buildSuggestedPrompts({
      workspaceId: WORKSPACE,
      opportunities: [opportunity("top", WORKSPACE, 90, "A current opportunity")],
      profile: profile(WORKSPACE, []),
    })).toEqual(FALLBACK_SUGGESTED_PROMPTS);
  });

  it("does not use opportunities or keywords owned by another workspace", () => {
    const prompts = buildSuggestedPrompts({
      workspaceId: WORKSPACE,
      opportunities: [opportunity("foreign", OTHER_WORKSPACE, 100, "Foreign customer need")],
      profile: profile(OTHER_WORKSPACE, ["foreign keyword"]),
    });

    expect(prompts).toEqual(FALLBACK_SUGGESTED_PROMPTS);
    expect(prompts.join(" ")).not.toContain("Foreign customer need");
    expect(prompts.join(" ")).not.toContain("foreign keyword");
  });

  it("passes the authorised workspace to both server readers and renders only its prompt context", async () => {
    mocks.authorize.mockResolvedValue({ ok: true });
    mocks.getBrandVoice.mockResolvedValue(null);
    mocks.getThread.mockResolvedValue(null);
    mocks.listThreads.mockResolvedValue([]);
    mocks.listDrafts.mockResolvedValue([]);
    mocks.listOpportunities.mockResolvedValue([
      opportunity("foreign", OTHER_WORKSPACE, 100, "Foreign customer need"),
      opportunity("local", WORKSPACE, 80, "Local onboarding question"),
    ]);
    mocks.getMonitoringProfile.mockResolvedValue(profile(WORKSPACE));

    const page = await ContentPage({ searchParams: Promise.resolve({ workspaceId: WORKSPACE }) });
    const client = Children.toArray(page.props.children).find((child) =>
      isValidElement<{ suggestedPrompts?: string[] }>(child) && Array.isArray(child.props.suggestedPrompts),
    ) as ReactElement<{ suggestedPrompts: string[] }> | undefined;

    expect(mocks.listOpportunities).toHaveBeenCalledWith({ workspaceId: WORKSPACE, limit: 3 });
    expect(mocks.getMonitoringProfile).toHaveBeenCalledWith(WORKSPACE);
    expect(client?.props.suggestedPrompts).toHaveLength(3);
    expect(client?.props.suggestedPrompts.join(" ")).toContain("Local onboarding question");
    expect(client?.props.suggestedPrompts.join(" ")).not.toContain("Foreign customer need");
  });

  it("fills the composer when a suggested prompt is selected", () => {
    const prompt = "Draft a useful Australian-English post.";
    const onSelect = vi.fn();
    const element = SuggestedPrompts({ prompts: [prompt], onSelect });
    const children = Children.toArray(element.props.children);
    const buttonGroup = children[1] as ReactElement<{ children: ReactNode }>;
    const button = Children.toArray(buttonGroup.props.children)[0] as ReactElement<{ onClick: () => void }>;

    button.props.onClick();
    expect(onSelect).toHaveBeenCalledWith(prompt);
  });

  it("always renders three visible fallback choices", () => {
    const html = renderToStaticMarkup(createElement(SuggestedPrompts, {
      prompts: FALLBACK_SUGGESTED_PROMPTS,
      onSelect: vi.fn(),
    }));

    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Suggested prompts"');
  });
});

beforeEach(() => {
  vi.resetAllMocks();
});
