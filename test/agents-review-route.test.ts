import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ review: vi.fn(), ingest: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/agents/review", () => ({ reviewIngestedDocuments: (...args: unknown[]) => state.review(...args) }));
vi.mock("@/lib/agents/discovery/apply", () => ({ ingestReviewedSourcesUnderScanLease: (...args: unknown[]) => state.ingest(...args) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => { state.db(); throw new Error("the route reaches the database only through the review module"); } }));

import { POST } from "@/app/api/internal/scan/review/route";

const WS = "11111111-1111-4111-8111-111111111111";
const call = (authorization?: string, workspaceId: string = WS) => POST(new Request("https://test/api/internal/scan/review", {
  method: "POST", headers: authorization ? { authorization } : {}, body: JSON.stringify({ workspaceId }),
}));

beforeEach(() => {
  state.review.mockReset().mockResolvedValue({ checked: 2, flagged: ["Profile: Hacker News"] });
  state.ingest.mockReset().mockResolvedValue({ ingested: ["HN: acme"], waiting: [] });
  state.db.mockReset();
  vi.stubEnv("CRON_SECRET", "synthetic-service-bearer");
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "Bearer wrong"])("rejects a missing or wrong bearer (%s) before any review work", async (authorization) => {
  expect((await call(authorization)).status).toBe(401);
  expect(state.review).not.toHaveBeenCalled();
  expect(state.ingest).not.toHaveBeenCalled();
});

it("rejects a body without a workspace UUID", async () => {
  expect((await call("Bearer synthetic-service-bearer", "not-a-uuid")).status).toBe(400);
  expect(state.review).not.toHaveBeenCalled();
});

it("runs the review for the named workspace and returns its small summary", async () => {
  const res = await call("Bearer synthetic-service-bearer");
  expect(res.status).toBe(200);
  expect(state.review).toHaveBeenCalledWith(WS);
  expect(await res.json()).toEqual({ checked: 2, flagged: ["Profile: Hacker News"], sources: { ingested: ["HN: acme"], waiting: [] } });
});

it("ingests reviewed sources that were left waiting while a scan held the lease", async () => {
  const res = await call("Bearer synthetic-service-bearer");
  expect(res.status).toBe(200);
  expect(state.ingest).toHaveBeenCalledWith(WS, expect.any(AbortSignal));
});

it("keeps the review result when ingesting the waiting sources fails", async () => {
  state.ingest.mockRejectedValueOnce(new Error("provider down"));
  const res = await call("Bearer synthetic-service-bearer");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ checked: 2, flagged: ["Profile: Hacker News"], sources: { ingested: [], waiting: [] } });
});
