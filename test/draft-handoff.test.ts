import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, readRows: null as Array<Record<string, unknown>> | null, updates: [] as Record<string, unknown>[], platform: "github", content: "", duringReview: null as (() => Promise<void>) | null }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  select: () => ({ from: () => ({ where: (condition: SQL) => {
    const query = new PgDialect().sqlToQuery(condition);
    const rows = () => (state.readRows ?? [state.row]).filter(row => {
      for (const [column, field] of [["id", "id"], ["workspace_id", "workspaceId"], ["opportunity_id", "opportunityId"]]) {
        const parameter = query.sql.match(new RegExp(`"${column}"\\s*=\\s*\\$(\\d+)`));
        if (parameter && row[field] !== query.params[Number(parameter[1]) - 1]) return false;
      }
      const target = query.sql.match(/->>\s*'targetDocumentId'\s*\)?\s*=\s*\$(\d+)/);
      const quality = row.quality as { targetDocumentId?: string } | null;
      if (target && quality?.targetDocumentId !== query.params[Number(target[1]) - 1]) return false;
      if (/"quality"\s+is\s+null/i.test(query.sql) && row.quality !== null) return false;
      return true;
    }).map(row => ({ ...row }));
    return { limit: async (count: number) => rows().slice(0, count),
      orderBy: () => ({ limit: async (count: number) => rows().sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, count) }) };
  } }) }),
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
  state.platform = "github"; state.content = text; state.readRows = null; state.updates = []; state.duringReview = null;
  state.row = { id: "d1", workspaceId: "ws", opportunityId: "op", originalText: text, editedText: text, citations: [], flags: [], approvedAt: null, createdAt: new Date("2026-10-07T00:00:00Z"), updatedAt: new Date("2026-10-07T00:00:00Z"),
    quality: { version: 1, kind: "draft", model: "model", targetDocumentId: "e1", rulesReviewed: true, angle: "Avoid leakage", gap: { existingReplyCount: 0, note: "Check hidden-test isolation" }, notes: [], claims: ["Agent ABC supports local model evaluation.", "Keep the test set separate from the agent context."].map(sentence => ({ sentence, documentId: "e1", quote: sentence })) } };
});
const opts = { workspaceId: "ws", draftId: "d1", factsReviewed: true, rulesReviewed: true };
const targetA = "11111111-1111-4111-8111-111111111111";
const targetB = "22222222-2222-4222-8222-222222222222";
const savedDraft = (id: string, targetDocumentId: string | null, hour: number, scope = {}) => ({
  ...state.row, id, createdAt: new Date(Date.UTC(2026, 9, 7, hour)), ...scope,
  quality: targetDocumentId ? { ...(state.row.quality as object), targetDocumentId } : null,
});
it("returns the newest exact target before newer other-target or legacy drafts, within both scopes", async () => {
  state.readRows = [savedDraft("a-old", targetA, 1), savedDraft("a-new", targetA, 2), savedDraft("b", targetB, 3),
    savedDraft("legacy", null, 4), savedDraft("foreign-workspace", targetA, 5, { workspaceId: "other" }),
    savedDraft("foreign-opportunity", targetA, 6, { opportunityId: "other" })];
  expect(await getLatestDraft({ workspaceId: "ws", opportunityId: "op", targetDocumentId: targetA })).toMatchObject({
    id: "a-new", quality: { targetDocumentId: targetA },
  });
});
it("falls back only to a scoped legacy draft and keeps legacy approval blocked", async () => {
  state.readRows = [savedDraft("b", targetB, 5), savedDraft("legacy", null, 2),
    savedDraft("foreign-workspace", null, 6, { workspaceId: "other" }),
    savedDraft("foreign-opportunity", null, 7, { opportunityId: "other" })];
  expect(await getLatestDraft({ workspaceId: "ws", opportunityId: "op", targetDocumentId: targetA })).toMatchObject({
    id: "legacy", quality: null, approvedAt: null,
  });
  await expect(approveDraftForHandoff({ ...opts, draftId: "legacy" })).rejects.toThrow(/Regenerate this draft/i);
  expect(state.updates).toHaveLength(0);
});
it("does not substitute another target when no exact or legacy draft exists", async () => {
  state.readRows = [savedDraft("b", targetB, 1)];
  expect(await getLatestDraft({ workspaceId: "ws", opportunityId: "op", targetDocumentId: targetA })).toBeNull();
});
it("keeps omitted-target callers on the newest scoped opportunity draft", async () => {
  state.readRows = [savedDraft("a", targetA, 1), savedDraft("b", targetB, 2),
    savedDraft("foreign", targetA, 3, { workspaceId: "other" })];
  expect(await getLatestDraft({ workspaceId: "ws", opportunityId: "op" })).toMatchObject({ id: "b" });
});
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
