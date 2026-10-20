import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("@/lib/digest/dispatch", () => ({ runDueDigests: dispatch }));

import { POST } from "@/app/api/cron/digest/route";

function call(authorization?: string, body?: unknown) {
  return POST(new Request("https://example.com/api/cron/digest", {
    method: "POST",
    headers: authorization ? { authorization, "content-type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
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
    const digest = { checked: 1, sent: 1, skipped: 0, failed: 0, hasMore: false };
    dispatch.mockResolvedValue(digest);
    const response = await call("Bearer secret", { workspaceId: "ws-1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, digest });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(expect.any(Date), "ws-1", { skipActiveScans: false });
  });

  it("returns a retryable status when a workspace digest fails", async () => {
    const digest = { checked: 1, sent: 0, skipped: 0, failed: 1, hasMore: false };
    dispatch.mockResolvedValue(digest);
    const response = await call("Bearer secret", { workspaceId: "ws-1" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, digest });
  });

  it("sweeps every due workspace when no scope is named, leaving scanning workspaces to their Workflow", async () => {
    const digest = { checked: 2, sent: 2, skipped: 0, failed: 0, hasMore: false };
    dispatch.mockResolvedValue(digest);
    const response = await call("Bearer secret", {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, digest });
    expect(dispatch).toHaveBeenCalledWith(expect.any(Date), undefined, { skipActiveScans: true });
  });

  it("sweeps when the body is absent entirely", async () => {
    dispatch.mockResolvedValue({ checked: 0, sent: 0, skipped: 0, failed: 0, hasMore: false });
    expect((await call("Bearer secret")).status).toBe(200);
    expect(dispatch).toHaveBeenCalledWith(expect.any(Date), undefined, { skipActiveScans: true });
  });

  it("rejects a malformed scope instead of falling back to the sweep", async () => {
    for (const workspaceId of [42, "", "   ", null]) {
      expect((await call("Bearer secret", { workspaceId })).status).toBe(400);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns a generic failure without exposing provider details", async () => {
    dispatch.mockRejectedValue(new TypeError("provider secret request detail"));
    const response = await call("Bearer secret", { workspaceId: "ws-1" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "digest dispatch failed" });
    expect(console.error).toHaveBeenCalledWith("[digest-cron] dispatch failed", "TypeError");
  });
});
