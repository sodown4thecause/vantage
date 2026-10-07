import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, updates: [] as Record<string, unknown>[], platform: "github", content: "Agent ABC supports local model evaluation." }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.row] }) }) }),
  update: () => ({ set: (values: Record<string, unknown>) => ({ where: () => ({ returning: async () => { state.updates.push(values); return [{ ...state.row, ...values }]; } }) }) }),
}) }));
vi.mock("@/lib/opportunities/run", () => ({ getOpportunityDetail: async () => ({ title: "Evaluation", summary: "Question", recommendedAction: "Help", evidence: [{ documentId: "e1", title: "Question", platform: state.platform, urlCanonical: state.platform === "hn" ? "https://news.ycombinator.com/item?id=1" : "https://github.com/example/tool/issues/1", contentMd: state.content }] }) }));
import { approveDraftForHandoff } from "@/lib/drafting/repository";
beforeEach(() => {
  state.platform = "github"; state.content = "Agent ABC supports local model evaluation."; state.updates = [];
  const text = "Agent ABC supports local model evaluation. Keep the test set separate from the agent context.";
  state.row = { id: "d1", workspaceId: "ws", opportunityId: "op", originalText: text, editedText: text, citations: [], flags: [], approvedAt: null, createdAt: new Date(), updatedAt: new Date(),
    quality: { version: 1, kind: "draft", model: "model", targetDocumentId: "e1", rulesReviewed: true, angle: "Avoid leakage", gap: { existingReplyCount: 0, note: "Check hidden-test isolation" }, notes: [], claims: [{ sentence: "Agent ABC supports local model evaluation.", documentId: "e1", quote: "Agent ABC supports local model evaluation." }] } };
});
const opts = { workspaceId: "ws", draftId: "d1", factsReviewed: true, rulesReviewed: true };
it("requires human facts and rules review and rechecks edited factual statements", async () => {
  await expect(approveDraftForHandoff({ ...opts, factsReviewed: false })).rejects.toThrow(/Review the facts/i);
  state.row.editedText = `This agent has certified SOC 2 controls and ${state.row.originalText}`;
  await expect(approveDraftForHandoff(opts)).rejects.toThrow(/complete factual statement/i);
  expect(state.updates).toHaveLength(0);
});
it("allows unchanged HN research briefs containing literal source language", async () => {
  state.platform = "hn"; state.content = "My coding agent always fails the hidden tests.";
  const text = `Research brief\nEvidence: ${state.content}`;
  state.row.originalText = text; state.row.editedText = text;
  state.row.quality = { ...(state.row.quality as object), kind: "brief", claims: [] };
  expect((await approveDraftForHandoff(opts)).approvedAt).not.toBeNull();
});
it("checks the actual prohibited venue again at handoff", async () => {
  state.platform = "hn";
  await expect(approveDraftForHandoff(opts)).rejects.toThrow(/prohibits/i);
});
