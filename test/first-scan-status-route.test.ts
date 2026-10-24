import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ auth: { ok: false, status: 401 } as { ok: boolean; status?: number }, retry: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: vi.fn(async () => state.auth) }));
vi.mock("@/lib/activation/dispatch", () => ({ firstScan: vi.fn(), startFirstScan: (...args: unknown[]) => state.retry(...args) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => state.db() }));
import { GET, POST } from "@/app/api/workspace/first-scan/route";
import { authorizeWorkspace } from "@/lib/auth/workspace";
const WS = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { state.auth = { ok: false, status: 401 }; state.retry.mockReset(); state.db.mockReset(); vi.mocked(authorizeWorkspace).mockClear(); });

it.each([401, 403])("gives signed-out and foreign-workspace users the same 404 (%s), without reads, writes or dispatch", async (status) => {
  state.auth = { ok: false, status };
  const response = await GET(new Request(`https://test/api/workspace/first-scan?workspaceId=${WS}`));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not found" });
  expect((await POST(new Request("https://test/api/workspace/first-scan", { method: "POST", body: JSON.stringify({ workspaceId: WS }) }))).status).toBe(404);
  expect(authorizeWorkspace).toHaveBeenCalledWith(WS);
  expect(state.retry).not.toHaveBeenCalled();
  expect(state.db).not.toHaveBeenCalled();
});

it("validates malformed scope before authorisation and dispatches only the authorised workspace", async () => {
  expect((await GET(new Request("https://test/api/workspace/first-scan?workspaceId=bad"))).status).toBe(404);
  expect(authorizeWorkspace).not.toHaveBeenCalled();
  state.auth = { ok: true };
  state.retry.mockResolvedValue({ status: "queued" });
  expect((await POST(new Request("https://test/api/workspace/first-scan", { method: "POST", body: JSON.stringify({ workspaceId: WS }) }))).status).toBe(202);
  expect(state.retry).toHaveBeenCalledExactlyOnceWith(WS, true);
});
