import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ review: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/agents/review", () => ({ reviewIngestedDocuments: (...args: unknown[]) => state.review(...args) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => { state.db(); throw new Error("the route reaches the database only through the review module"); } }));

import { POST } from "@/app/api/internal/scan/review/route";

const WS = "11111111-1111-4111-8111-111111111111";
const call = (authorization?: string, workspaceId: string = WS) => POST(new Request("https://test/api/internal/scan/review", {
  method: "POST", headers: authorization ? { authorization } : {}, body: JSON.stringify({ workspaceId }),
}));

beforeEach(() => {
  state.review.mockReset().mockResolvedValue({ checked: 2, flagged: ["Profile: Hacker News"] });
  state.db.mockReset();
  vi.stubEnv("CRON_SECRET", "synthetic-service-bearer");
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "Bearer wrong"])("rejects a missing or wrong bearer (%s) before any review work", async (authorization) => {
  expect((await call(authorization)).status).toBe(401);
  expect(state.review).not.toHaveBeenCalled();
});

it("rejects a body without a workspace UUID", async () => {
  expect((await call("Bearer synthetic-service-bearer", "not-a-uuid")).status).toBe(400);
  expect(state.review).not.toHaveBeenCalled();
});

it("runs the review for the named workspace and returns its small summary", async () => {
  const res = await call("Bearer synthetic-service-bearer");
  expect(res.status).toBe(200);
  expect(state.review).toHaveBeenCalledWith(WS);
  expect(await res.json()).toEqual({ checked: 2, flagged: ["Profile: Hacker News"] });
});
