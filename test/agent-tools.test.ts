import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureTodaysPicks: vi.fn(),
  workspaceTimeZone: vi.fn(),
  getOpportunityDetail: vi.fn(),
}));

vi.mock("@/lib/retention/picks", () => ({ ensureTodaysPicks: mocks.ensureTodaysPicks }));
vi.mock("@/lib/retention/zone", () => ({ workspaceTimeZone: mocks.workspaceTimeZone }));
vi.mock("@/lib/opportunities/run", () => ({ getOpportunityDetail: mocks.getOpportunityDetail }));

import { agentTools } from "@/lib/agent/mcp/tools";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OPPORTUNITY = "22222222-2222-4222-8222-222222222222";
const ctx = { workspaceId: WORKSPACE, userId: "user_1", scopes: ["vantage.read"] };

const tool = (name: string) => agentTools().find((candidate) => candidate.name === name)!;

const card = {
  id: OPPORTUNITY,
  workspaceId: WORKSPACE,
  status: "opportunity" as const,
  title: "Looking for a cheaper analytics tool",
  summary: "Someone wants to replace their current tool.",
  whyItMatters: "They described the exact problem the product solves.",
  whyNow: "Posted four hours ago and still unanswered.",
  recommendedAction: "Reply with the migration path.",
  confidence: 0.8123,
  urgency: 0.7,
  score: 0.8765,
  coverage: "full",
  features: {
    fit: 0.9,
    intent: 0.8,
    evidence: 0.7,
    momentum: 0.6,
    timing: 0.5,
    modelConfidence: 0.8,
    lowConfidence: false,
  },
  evidenceCount: 2,
  clusterKey: "cluster-1",
  createdAt: "2026-11-06T00:00:00.000Z",
  updatedAt: "2026-11-06T00:00:00.000Z",
};

beforeEach(() => {
  mocks.ensureTodaysPicks.mockReset();
  mocks.workspaceTimeZone.mockReset();
  mocks.getOpportunityDetail.mockReset();
  mocks.workspaceTimeZone.mockResolvedValue("Australia/Brisbane");
});

describe("list_todays_conversations", () => {
  it("returns the same day and cards the queue page shows", async () => {
    mocks.ensureTodaysPicks.mockResolvedValue({ day: "2026-11-06", cards: [card] });

    const value = (await tool("list_todays_conversations").run({}, ctx)) as {
      day: string;
      timeZone: string;
      conversations: Array<{ id: string; score: number; confidence: number }>;
    };

    expect(mocks.ensureTodaysPicks).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      timeZone: "Australia/Brisbane",
    });
    expect(value.day).toBe("2026-11-06");
    expect(value.timeZone).toBe("Australia/Brisbane");
    expect(value.conversations).toHaveLength(1);
    expect(value.conversations[0]!.id).toBe(OPPORTUNITY);
    expect(value.conversations[0]!.score).toBe(0.88);
    expect(value.conversations[0]!.confidence).toBe(0.81);
  });

  it("explains an empty day instead of pretending there is data", async () => {
    mocks.ensureTodaysPicks.mockResolvedValue({ day: "2026-11-06", cards: [] });
    const value = (await tool("list_todays_conversations").run({}, ctx)) as {
      conversations: unknown[];
      message: string;
    };
    expect(value.conversations).toEqual([]);
    expect(value.message).toContain("No conversation");
  });

  it("returns an honest empty answer without a workspace", async () => {
    const value = (await tool("list_todays_conversations").run(
      {},
      { ...ctx, workspaceId: null },
    )) as { conversations: unknown[]; message: string };
    expect(value.conversations).toEqual([]);
    expect(value.message).toContain("claim");
    expect(mocks.ensureTodaysPicks).not.toHaveBeenCalled();
  });
});

describe("get_conversation", () => {
  it("scopes the lookup to the credential's workspace, not the caller's input", async () => {
    mocks.getOpportunityDetail.mockResolvedValue({
      ...card,
      evidence: [
        {
          documentId: "doc_1",
          title: "Thread",
          urlCanonical: "https://example.com/thread",
          platform: "reddit",
          contentMd: "x".repeat(10_000),
          postedAt: "2026-11-06T00:00:00.000Z",
          provider: "scavio",
          contentKind: "full_thread",
          subreddit: "saas",
          score: 12,
          existingReplies: ["Try the other one"],
        },
      ],
    });

    const value = (await tool("get_conversation").run(
      { opportunityId: OPPORTUNITY, workspaceId: "99999999-9999-4999-8999-999999999999" },
      ctx,
    )) as {
      conversation: { evidence: Array<{ content: string; truncated: boolean }> };
    };

    expect(mocks.getOpportunityDetail).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      opportunityId: OPPORTUNITY,
    });
    expect(value.conversation.evidence[0]!.content).toHaveLength(6_000);
    expect(value.conversation.evidence[0]!.truncated).toBe(true);
  });

  it("refuses a malformed id without querying", async () => {
    const value = (await tool("get_conversation").run({ opportunityId: "nope" }, ctx)) as {
      conversation: null;
      message: string;
    };
    expect(value.conversation).toBeNull();
    expect(value.message).toContain("opportunityId");
    expect(mocks.getOpportunityDetail).not.toHaveBeenCalled();
  });

  it("reports a conversation outside the workspace as not found", async () => {
    mocks.getOpportunityDetail.mockResolvedValue(null);
    const value = (await tool("get_conversation").run({ opportunityId: OPPORTUNITY }, ctx)) as {
      conversation: null;
      message: string;
    };
    expect(value.conversation).toBeNull();
    expect(value.message).toContain("another workspace");
  });

  it("returns an honest empty answer without a workspace", async () => {
    const value = (await tool("get_conversation").run(
      { opportunityId: OPPORTUNITY },
      { ...ctx, workspaceId: null },
    )) as { conversation: null; message: string };
    expect(value.conversation).toBeNull();
    expect(mocks.getOpportunityDetail).not.toHaveBeenCalled();
  });

  it("caps the evidence count and reports what it left out", async () => {
    const evidence = Array.from({ length: 12 }, (_, index) => ({
      documentId: `doc_${index}`,
      title: `Thread ${index}`,
      urlCanonical: `https://example.com/${index}`,
      platform: "reddit",
      contentMd: "short post",
      postedAt: null,
      provider: null,
    }));
    mocks.getOpportunityDetail.mockResolvedValue({ ...card, evidence });

    const value = (await tool("get_conversation").run({ opportunityId: OPPORTUNITY }, ctx)) as {
      conversation: { evidence: unknown[]; evidenceCount: number; omittedEvidence: number };
      message: string;
    };

    expect(value.conversation.evidence).toHaveLength(5);
    expect(value.conversation.evidenceCount).toBe(12);
    expect(value.conversation.omittedEvidence).toBe(7);
    expect(value.message).toContain("7 more posts");
  });

  it("holds one total text budget across posts and replies", async () => {
    // Six posts of 6,000 characters plus ten 1,000-character replies each would
    // be 96,000 characters without a shared budget.
    const evidence = Array.from({ length: 6 }, (_, index) => ({
      documentId: `doc_${index}`,
      title: `Thread ${index}`,
      urlCanonical: `https://example.com/${index}`,
      platform: "reddit",
      contentMd: "x".repeat(6_000),
      postedAt: null,
      provider: null,
      existingReplies: Array.from({ length: 10 }, () => "y".repeat(1_000)),
    }));
    mocks.getOpportunityDetail.mockResolvedValue({ ...card, evidence });

    const value = (await tool("get_conversation").run({ opportunityId: OPPORTUNITY }, ctx)) as {
      conversation: {
        evidence: Array<{ content: string; existingReplies: string[]; truncated: boolean }>;
      };
    };

    const total = value.conversation.evidence.reduce(
      (sum, item) =>
        sum + item.content.length + item.existingReplies.reduce((n, reply) => n + reply.length, 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(24_000);
    // The first post is complete; later ones are cut, and say so.
    expect(value.conversation.evidence[0]!.content).toHaveLength(6_000);
    expect(value.conversation.evidence[0]!.truncated).toBe(false);
    expect(value.conversation.evidence.at(-1)!.truncated).toBe(true);
  });
});

describe("tool registry", () => {
  it("exposes only read-scoped tools and no write surface", () => {
    const tools = agentTools();
    expect(tools.map((entry) => entry.name)).toEqual([
      "get_workspace_context",
      "list_todays_conversations",
      "get_conversation",
    ]);
    for (const entry of tools) {
      expect(entry.requiredScope).toBe("vantage.read");
      expect(entry.inputSchema).toMatchObject({ type: "object" });
    }
  });
});
