import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: true, failure: null as Error | null, create: vi.fn(), latest: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: async () => state.allowed ? { ok: true } : { ok: false, status: 401, error: "unauthorized" } }));
vi.mock("@/lib/drafting/repository", () => ({
  DraftInputError: class DraftInputError extends Error {},
  createDraftForOpportunity: async (input: unknown) => { state.create(input); if (state.failure) throw state.failure; return {}; },
  getLatestDraft: state.latest,
  updateDraftText: async () => { if (state.failure) throw state.failure; return {}; },
  approveDraftForHandoff: async () => { if (state.failure) throw state.failure; return {}; },
}));
import { DraftInputError } from "@/lib/drafting/repository";
import { GET, POST } from "@/app/api/drafts/route";
import { validateContribution } from "@/lib/drafting/contribution";

beforeEach(() => { state.allowed = true; state.failure = null; state.create.mockClear(); state.latest.mockReset(); state.latest.mockResolvedValue(null); vi.spyOn(console, "error").mockImplementation(() => {}); });
const request = (action = "create") => new Request("https://vantage.test/api/drafts", { method: "POST", body: JSON.stringify({ workspaceId: "ws", opportunityId: "op", draftId: "draft", targetDocumentId: "stale", action }) });
const target = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const getRequest = (targetDocumentId?: string) => {
  const url = new URL("https://vantage.test/api/drafts?workspaceId=ws&opportunityId=op");
  if (targetDocumentId !== undefined) url.searchParams.set("targetDocumentId", targetDocumentId);
  return new Request(url);
};

it.each([target, ` ${target.toUpperCase()} `])("scopes target-aware GET to the authorized workspace and opportunity", async query => {
  state.latest.mockResolvedValue({ id: "saved-a", quality: { targetDocumentId: target } });
  const response = await GET(getRequest(query));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ draft: { id: "saved-a" } });
  expect(state.latest).toHaveBeenCalledWith({ workspaceId: "ws", opportunityId: "op", targetDocumentId: target });
});
it("preserves opportunity-global lookup when GET omits a target", async () => {
  expect((await GET(getRequest())).status).toBe(200);
  expect(state.latest).toHaveBeenCalledWith({ workspaceId: "ws", opportunityId: "op" });
});
it("authenticates before validating a malformed target query", async () => {
  state.allowed = false;
  expect((await GET(getRequest("malformed"))).status).toBe(401);
  expect(state.latest).not.toHaveBeenCalled();
});
it.each(["", "not-a-uuid", "11111111-1111-4111-8111-11111111111g"])("returns safe 400 for target query %j", async value => {
  const response = await GET(getRequest(value));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "targetDocumentId must be a UUID" });
  expect(state.latest).not.toHaveBeenCalled();
});
it("keeps target-aware lookup failures private", async () => {
  state.latest.mockRejectedValue(new Error("private database details"));
  const response = await GET(getRequest(target));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "draft request failed" });
});

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
