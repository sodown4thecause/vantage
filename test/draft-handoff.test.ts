import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, updates: [] as Record<string, unknown>[], platform: "github", content: "", duringReview: null as (() => Promise<void>) | null }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ...state.row }], orderBy: () => ({ limit: async () => [{ ...state.row }] }) }) }) }),
  update: () => ({ set: (values: Record<string, unknown>) => ({ where: (condition: SQL) => ({ returning: async () => {
    const query = new PgDialect().sqlToQuery(condition);
    for (const [column, field] of [["id", "id"], ["workspace_id", "workspaceId"], ["edited_text", "editedText"], ["updated_at", "updatedAt"]]) {
      const parameter = query.sql.match(new RegExp(`"${column}"\\s*=\\s*\\$(\\d+)`));
      if (!parameter) continue;
      const actual = state.row[field], expected = query.params[Number(parameter[1]) - 1];
      if ((actual instanceof Date ? actual.toISOString() : actual) !== (expected instanceof Date ? expected.toISOString() : expected)) return [];
    }
    state.updates.push(values); state.row = { ...state.row, ...values };
    return [{ ...state.row }];
  } }) }) }),
}) }));
vi.mock("@/lib/opportunities/run", () => ({ getOpportunityDetail: async () => {
  const duringReview = state.duringReview; state.duringReview = null;
  await duringReview?.();
  return { title: "Evaluation", summary: "Question", recommendedAction: "Help", evidence: [{ documentId: "e1", title: "Question", platform: state.platform, urlCanonical: state.platform === "hn" ? "https://news.ycombinator.com/item?id=1" : "https://github.com/example/tool/issues/1", contentMd: state.content }] };
} }));
import { approveDraftForHandoff, getLatestDraft, updateDraftText } from "@/lib/drafting/repository";
beforeEach(() => {
  const text = "Agent ABC supports local model evaluation. Keep the test set separate from the agent context.";
  state.platform = "github"; state.content = text; state.updates = []; state.duringReview = null;
  state.row = { id: "d1", workspaceId: "ws", opportunityId: "op", originalText: text, editedText: text, citations: [], flags: [], approvedAt: null, createdAt: new Date("2026-10-07T00:00:00Z"), updatedAt: new Date("2026-10-07T00:00:00Z"),
    quality: { version: 1, kind: "draft", model: "model", targetDocumentId: "e1", rulesReviewed: true, angle: "Avoid leakage", gap: { existingReplyCount: 0, note: "Check hidden-test isolation" }, notes: [], claims: ["Agent ABC supports local model evaluation.", "Keep the test set separate from the agent context."].map(sentence => ({ sentence, documentId: "e1", quote: sentence })) } };
});
const opts = { workspaceId: "ws", draftId: "d1", factsReviewed: true, rulesReviewed: true };
it("requires human facts and rules review and rechecks edited factual statements", async () => {
  await expect(approveDraftForHandoff({ ...opts, factsReviewed: false })).rejects.toThrow(/Review the facts/i);
  await expect(approveDraftForHandoff({ ...opts, rulesReviewed: false })).rejects.toThrow(/community's rules/i);
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
it.each([
  { version: 2 }, { kind: "publish" }, { model: 7 }, { rulesReviewed: "yes" },
  { gap: null }, { gap: { existingReplyCount: -1, note: "Invalid count" } },
  { claims: "missing" }, { claims: [null] }, { claims: [{ sentence: "Claim", documentId: "e1" }] },
  { notes: [12] },
])("rejects incompatible stored review metadata with a regeneration error: %j", async patch => {
  state.row.quality = { ...(state.row.quality as object), ...patch };
  await expect(approveDraftForHandoff(opts)).rejects.toThrow(/Regenerate this draft/i);
  expect(state.updates).toHaveLength(0);
});
it("returns a safe legacy view for malformed persisted review metadata", async () => {
  state.row.quality = { version: 1, kind: "draft", targetDocumentId: "e1" };
  state.row.citations = { broken: true }; state.row.flags = [null]; state.row.approvedAt = new Date();
  const draft = await getLatestDraft({ workspaceId: "ws", opportunityId: "op" });
  expect(draft).toMatchObject({ quality: null, citations: [], flags: [], approvedAt: null });
});
it("does not approve text edited after the review snapshot was loaded", async () => {
  const editedText = "This agent has certified SOC 2 controls and retains private customer data for 90 days.";
  state.duringReview = () => updateDraftText({ workspaceId: "ws", draftId: "d1", editedText }).then(() => {});
  await expect(approveDraftForHandoff(opts)).rejects.toThrow(/changed.*review|review.*latest/i);
  expect(state.row.editedText).toBe(editedText);
  expect(state.row.approvedAt).toBeNull();
  expect(state.updates).toHaveLength(1);
});
