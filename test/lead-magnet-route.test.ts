import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: true,
  calls: [] as string[],
}));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: async (workspaceId: string) => {
    state.calls.push(`auth:${workspaceId}`);
    return state.authorized ? { ok: true, userId: "u" } : { ok: false, status: 403, error: "forbidden" };
  },
}));
vi.mock("@/lib/lead-magnet/run", () => ({
  runFreeScan: async (workspaceId: string) => {
    state.calls.push(`scan:${workspaceId}`);
    return { ok: true, label: "Free basic scan", scannedAt: "now", sources: [], sourcesUsed: ["hn"], documentsScanned: 0, cards: [], message: "done" };
  },
}));

import { POST } from "@/app/api/lead-magnet/run/route";

const req = (body: unknown) =>
  new Request("https://vantage.test/api/lead-magnet/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.authorized = true;
  state.calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

it("requires a workspaceId", async () => {
  const res = await POST(req({}));
  expect(res.status).toBe(400);
  expect(state.calls).toEqual([]);
});

it("refuses an unauthorised workspace before scanning", async () => {
  state.authorized = false;
  const res = await POST(req({ workspaceId: "ws-1" }));
  expect(res.status).toBe(403);
  expect(state.calls).toEqual(["auth:ws-1"]);
});

it("authorises the workspace, then runs the free scan", async () => {
  const res = await POST(req({ workspaceId: "ws-1" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, sourcesUsed: ["hn"] });
  expect(state.calls).toEqual(["auth:ws-1", "scan:ws-1"]);
});

it("never returns raw error text", async () => {
  state.authorized = false;
  const res = await POST(req({ workspaceId: "ws-1" }));
  expect(JSON.stringify(await res.json())).not.toContain("postgres");
});
