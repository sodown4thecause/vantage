import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), execute: vi.fn(), batch: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ execute: mocks.execute, batch: mocks.batch }) }));
import { POST } from "@/app/api/gtm/proposals/[id]/route";
import { applyStrategyProposal } from "@/lib/gtm/proposals/apply";
import { getStrategyState } from "@/lib/gtm/proposals/repository";
const workspaceId = crypto.randomUUID(), conversationId = crypto.randomUUID(), proposalId = crypto.randomUUID();
const body = { workspaceId, conversationId, strategyVersion: 0, requestId: "click-1", payloadHash: "a".repeat(64), state: "approval-responded", approval: { id: proposalId, approved: true } };
const request = (value: unknown, origin = "https://contextfor.dev") => new Request(`https://contextfor.dev/api/gtm/proposals/${proposalId}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value) });
const context = { params: Promise.resolve({ id: proposalId }) };
beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockResolvedValue({ ok: false, status: 403, error: "forbidden" }); });
it("refuses unauthorized decisions before proposal persistence", async () => {
  expect((await POST(request(body), context)).status).toBe(403);
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
});
it("refuses cross-origin requests and ambiguous approval", async () => {
  expect((await POST(request(body, "https://evil.example"), context)).status).toBe(403);
  expect((await POST(request({ ...body, approval: "yes" }), context)).status).toBe(400);
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("does not permit a model to supply its own actor or bypass authentication", async () => {
  await expect(applyStrategyProposal({ workspaceId, conversationId, proposalId, strategyVersion: 0, requestId: "model" })).rejects.toThrow();
  expect(mocks.execute).not.toHaveBeenCalled();
  expect((await POST(request({ ...body, actorId: "owner" }), context)).status).toBe(400);
});
it("rejects an authenticated model apply without a persisted human decision", async () => {
  mocks.authorize.mockResolvedValue({ ok: true, userId: "authenticated-owner" });
  mocks.batch.mockResolvedValue([[], [], [], []]);
  await expect(applyStrategyProposal({ workspaceId, conversationId, proposalId, strategyVersion: 0, requestId: "model" })).rejects.toThrow("unconfirmed");
});
it("authorizes canonical strategy reads before domain IO", async () => {
  await expect(getStrategyState({ workspaceId, conversationId })).rejects.toThrow("Unable to access");
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
});
