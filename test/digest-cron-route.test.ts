import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("@/lib/digest/dispatch", () => ({ runDueDigests: dispatch }));

import { POST } from "@/app/api/cron/digest/route";

function call(authorization?: string) {
  return POST(new Request("https://example.com/api/cron/digest", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  }));
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "secret");
  dispatch.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("digest cron route", () => {
  it.each([undefined, "Bearer wrong"])("refuses an unauthorized request before dispatch: %s", async (authorization) => {
    expect((await call(authorization)).status).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fails closed without a secret outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches due digests for an authenticated request", async () => {
    const digest = { checked: 3, sent: 1, skipped: 1, failed: 1, hasMore: false };
    dispatch.mockResolvedValue(digest);
    const response = await call("Bearer secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, digest });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("returns a generic failure without exposing provider details", async () => {
    dispatch.mockRejectedValue(new TypeError("provider secret request detail"));
    const response = await call("Bearer secret");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "digest dispatch failed" });
    expect(console.error).toHaveBeenCalledWith("[digest-cron] dispatch failed", "TypeError");
  });
});
