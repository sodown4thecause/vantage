import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: true, failure: null as Error | null, create: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: async () => state.allowed ? { ok: true } : { ok: false, status: 401, error: "unauthorized" } }));
vi.mock("@/lib/drafting/repository", () => ({
  DraftInputError: class DraftInputError extends Error {},
  createDraftForOpportunity: async (input: unknown) => { state.create(input); if (state.failure) throw state.failure; return {}; },
  getLatestDraft: vi.fn(),
  updateDraftText: async () => { if (state.failure) throw state.failure; return {}; },
  approveDraftForHandoff: async () => { if (state.failure) throw state.failure; return {}; },
}));
import { DraftInputError } from "@/lib/drafting/repository";
import { POST } from "@/app/api/drafts/route";
import { validateContribution } from "@/lib/drafting/contribution";

beforeEach(() => { state.allowed = true; state.failure = null; state.create.mockClear(); vi.spyOn(console, "error").mockImplementation(() => {}); });
const request = (action = "create") => new Request("https://vantage.test/api/drafts", { method: "POST", body: JSON.stringify({ workspaceId: "ws", opportunityId: "op", draftId: "draft", targetDocumentId: "stale", action }) });

it.each(["opportunity not found", "Conversation evidence not found."])("returns a correctable error for %s", async message => {
  state.failure = new DraftInputError(message);
  const response = await POST(request());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: message });
});
it.each(["create", "approve", "update"])("keeps %s failures private", async action => {
  state.failure = new Error("provider token must remain private");
  const response = await POST(request(action));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "draft request failed" });
});
it("checks authorization before creating a draft", async () => {
  state.allowed = false;
  expect((await POST(request())).status).toBe(401);
  expect(state.create).not.toHaveBeenCalled();
});
it("returns correctable contribution validation errors during approval", async () => {
  try { validateContribution({}, {} as Parameters<typeof validateContribution>[1], "model"); } catch (error) { state.failure = error as Error; }
  const response = await POST(request("approve"));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "A concise, useful contribution is required." });
});
