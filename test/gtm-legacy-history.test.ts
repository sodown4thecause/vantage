import { expect, it } from "vitest";
import { adaptLegacyTurns } from "@/lib/gtm/chat/legacy";
import { validateGtmMessages } from "@/lib/gtm/chat/types";
import type { SeoMessageRow } from "@/lib/seo-agent/conversations";
import type { InterviewState } from "@/lib/onboarding/interview";

const card = { tool: "gtm_journey", title: "Buyer conversations", fetchedAt: null, cached: false, data: { actions: [{ label: "Research" }], blocks: [{ type: "text", text: "Evidence" }] } };
const turn: SeoMessageRow = { id: "legacy-row", role: "assistant", content: "Your next step", parts: { cards: [card], notices: ["Cached evidence"], followUps: { seo: "a", geo: "b", content: "c" }, plan: [{ tool: "research", input: {}, credits: 1 }] }, status: "needs_approval", creditsUsed: 0, createdAt: "2026-10-25T00:00:00.000Z" };

it("preserves legacy text, GTM cards and context without mutating rollback rows", async () => {
  const before = structuredClone(turn);
  const messages = adaptLegacyTurns({ turns: [{ ...turn, id: "legacy-user", role: "user", parts: {}, content: "Find buyers" }, turn], interview: null });
  expect(messages[0]!.role).toBe("user");
  expect(messages[1]!.id).toBe(turn.id);
  expect(messages[1]!.parts).toContainEqual({ type: "text", text: turn.content });
  expect(messages[1]!.parts).toContainEqual({ type: "data-card", data: card });
  expect(messages[1]!.parts).toContainEqual({ type: "data-legacy", data: { status: turn.status, creditsUsed: 0, createdAt: turn.createdAt, followUps: turn.parts.followUps, plan: turn.parts.plan, notices: turn.parts.notices } });
  expect(await validateGtmMessages(messages)).toEqual(messages);
  expect(turn).toEqual(before);
});

it("keeps confirmed interview answers resumable and draft separate in read-only data", async () => {
  const interview: InterviewState = { answers: { productUrl: "https://example.com", targetCustomer: "Founders" }, draft: { productDescription: "Unconfirmed description" }, complete: false };
  const before = structuredClone(interview);
  const messages = adaptLegacyTurns({ turns: [turn], interview });
  expect(messages.at(-1)!.parts).toContainEqual({ type: "data-interview", data: interview });
  expect(messages.at(-1)!.parts).not.toContainEqual(expect.objectContaining({ type: "tool-save_profile" }));
  expect(await validateGtmMessages(messages)).toEqual(messages);
  expect(interview).toEqual(before);
});

it("carries state even when the legacy conversation has no turns", () => {
  const interview = { answers: { keywords: ["CRM"] }, complete: false };
  expect(adaptLegacyTurns({ turns: [], interview })[0]!.parts).toContainEqual({ type: "data-interview", data: interview });
  expect(adaptLegacyTurns({ turns: [], interview: null })).toEqual([]);
});
