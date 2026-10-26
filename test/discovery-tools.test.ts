import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evidenceRows: [] as Array<Record<string, unknown>>,
  where: vi.fn(), execute: vi.fn(), authorize: vi.fn(), createProposal: vi.fn(), strategy: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: () => ({ from: () => ({ where: mocks.where }) }), execute: mocks.execute }) }));
vi.mock("@/lib/gtm/proposals/repository", () => ({
  proposalActor: mocks.authorize,
  createStrategyProposal: mocks.createProposal,
  getStrategyState: mocks.strategy,
}));
import { discoveryTools } from "@/lib/agents/discovery/tools";
import type { DiscoveryPlan } from "@/lib/agents/discovery/profile";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const evidenceId = "22222222-2222-4222-8222-222222222222";
const forumEvidenceId = "55555555-5555-4555-8555-555555555555";
const evidence = {
  id: evidenceId, url: "https://product.example.com/compare", retrievedAt: new Date("2026-10-25T00:00:00.000Z"),
  excerpt: "Example Product offers incident response and issue tracking for teams with reliability and security. It includes analytics, workflows, customer support, integrations, compliance, audit logs, cost controls, monitoring, alerts, dashboards, and recovery. Compare at https://product.example.com/community.",
  provider: "direct", contentKind: "full", status: "verified",
};
const forumEvidence = {
  id: forumEvidenceId, url: "https://news.ycombinator.com/item?id=42", retrievedAt: new Date("2026-10-25T00:00:00.000Z"),
  excerpt: "Ask HN: How do teams discuss incident response and reliability?",
  provider: "direct", contentKind: "full", status: "verified",
};
const plan: DiscoveryPlan = {
  profile: { productUrl: "https://product.example.com", productDescription: "Incident response and issue tracking for teams.", targetCustomer: "Teams with reliability and security.", evidenceIds: [evidenceId] },
  competitors: [{ domain: "competitor.example", positioning: "Incident response platform", evidenceIds: [evidenceId] }],
  keywords: [{ term: "incident response", reason: "Discussed on the product page.", evidenceIds: [evidenceId] }],
  sources: [{ type: "hn", config: { query: "incident response" }, reason: "Relevant technical discussions.", evidenceIds: [forumEvidenceId], sampleUrls: ["https://news.ycombinator.com/item?id=42"] }],
  unknowns: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.where.mockResolvedValue([evidence, forumEvidence]);
  mocks.authorize.mockResolvedValue("owner");
  mocks.strategy.mockResolvedValue({ strategyVersion: 4, profile: null, sources: [], competitors: [], keywords: [] });
  mocks.createProposal.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333", workspaceId, conversationId, strategyVersion: 4, payload: { sources: [{ type: "hn", config: { query: "incident response" }, enabled: false }], exclusions: ["hiring posts"] }, payloadHash: "a".repeat(64), expiresAt: "2026-10-26T00:00:00.000Z", status: "pending" });
});

describe("workspace discovery proposal tools", () => {
  it("creates an exact pending proposal with cited evidence but performs no configuration write", async () => {
    const tools = discoveryTools({ workspaceId, conversationId, requestId: "turn-1", signal: new AbortController().signal });
    const result = await tools.propose_discovery_plan.execute!({ plan, exclusions: ["hiring posts"] }, { toolCallId: "tool-1", messages: [], context: {} });
    expect(mocks.authorize).toHaveBeenCalledWith(workspaceId);
    expect(mocks.createProposal).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId, conversationId, strategyVersion: 4,
      payload: expect.objectContaining({
        exclusions: ["hiring posts"],
        profile: expect.objectContaining({ productUrl: "https://product.example.com", topics: ["incident response"] }),
        sources: [{ type: "hn", config: { query: "incident response" }, enabled: false }],
      }),
    }));
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "pending", discovery: {
      plan: { sources: [{ sampleUrls: ["https://news.ycombinator.com/item?id=42"] }] },
      cadence: { recurring: false }, cost: { estimateUsd: null },
    } });
    expect((result as unknown as { discovery: { evidence: Array<{ id: string; status: string }> } }).discovery.evidence.map(row => [row.id, row.status])).toEqual(expect.arrayContaining([[evidenceId, "verified"], [forumEvidenceId, "verified"]]));
  });

  it("rejects an evidence ID from outside the workspace before proposing", async () => {
    mocks.where.mockResolvedValue([]);
    const tools = discoveryTools({ workspaceId, conversationId, requestId: "turn-1", signal: new AbortController().signal });
    await expect(tools.propose_discovery_plan.execute!({ plan: { ...plan, profile: { ...plan.profile, evidenceIds: ["44444444-4444-4444-8444-444444444444"] } } }, { toolCallId: "tool-1", messages: [], context: {} })).rejects.toThrow(/no workspace configuration was changed/i);
    expect(mocks.createProposal).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
