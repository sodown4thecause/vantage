import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { ok: true } as { ok: boolean; status?: number; error?: string },
  failWith: null as Error | null,
  calls: [] as string[],
}));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: async () => state.auth,
}));

vi.mock("@/lib/plays/repository", () => {
  class PlayNotFoundError extends Error {}
  const maybeFail = () => {
    if (state.failWith) throw state.failWith;
  };
  return {
    PlayNotFoundError,
    isSettablePlayStatus: (v: unknown) => ["accepted", "dismissed", "done"].includes(v as string),
    listForOpportunity: async () => {
      state.calls.push("list");
      maybeFail();
      return [];
    },
    suggestForOpportunity: async () => {
      state.calls.push("suggest");
      maybeFail();
      return [];
    },
    setStatus: async (o: { status: string }) => {
      state.calls.push(`set:${o.status}`);
      maybeFail();
      return { id: "p", status: o.status };
    },
  };
});

import { GET, PATCH, POST } from "@/app/api/plays/route";
import { PlayNotFoundError } from "@/lib/plays/repository";

const ID = "11111111-1111-4111-8111-111111111111";
const post = (method: string, body: unknown) =>
  new Request("http://x/api/plays", {
    method,
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.auth = { ok: true };
  state.failWith = null;
  state.calls = [];
});

describe("/api/plays", () => {
  it("validates input before authorizing", async () => {
    expect((await POST(post("POST", {}))).status).toBe(400);
    expect((await POST(post("POST", { workspaceId: "w", opportunityId: "nope" }))).status).toBe(400);
    expect((await PATCH(post("PATCH", { workspaceId: "w", playId: ID, status: "posted" }))).status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("returns the authorization failure without touching the repository", async () => {
    state.auth = { ok: false, status: 403, error: "forbidden" };
    const res = await GET(new Request(`http://x/api/plays?workspaceId=w&opportunityId=${ID}`));
    expect(res.status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("suggests and lists plays", async () => {
    const res = await POST(post("POST", { workspaceId: "w", opportunityId: ID }));
    expect(res.status).toBe(201);
    expect(state.calls).toEqual(["suggest", "list"]);
  });

  it("accepts and dismisses a play", async () => {
    const res = await PATCH(post("PATCH", { workspaceId: "w", playId: ID, status: "accepted" }));
    expect(res.status).toBe(200);
    await PATCH(post("PATCH", { workspaceId: "w", playId: ID, status: "dismissed" }));
    expect(state.calls).toEqual(["set:accepted", "set:dismissed"]);
  });

  it("maps not found to 404 and hides raw error text on failure", async () => {
    state.failWith = new PlayNotFoundError("play");
    const missing = await PATCH(post("PATCH", { workspaceId: "w", playId: ID, status: "done" }));
    expect(missing.status).toBe(404);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.failWith = new Error("password=hunter2 connection refused");
    const res = await GET(new Request(`http://x/api/plays?workspaceId=w&opportunityId=${ID}`));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
    spy.mockRestore();
  });
});
