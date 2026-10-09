import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: true,
  collectorRan: false,
}));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: async () =>
    state.authorized
      ? { ok: true, userId: "user-1" }
      : { ok: false, status: 401 as const, error: "unauthorized" as const },
}));

vi.mock("@/lib/collectors/run", () => ({
  runCollectorForType: async () => {
    state.collectorRan = true;
    return [];
  },
}));

import { handleCollectorPost } from "@/lib/collectors/route";
import { hnCollector } from "@/lib/collectors/hn";
import { checkRateLimit, rateLimitResponse } from "@/lib/http/rateLimit";

const rule = { limit: 3, windowMs: 1_000 };

afterEach(() => {
  state.authorized = true;
  state.collectorRan = false;
});

describe("checkRateLimit", () => {
  it("allows requests up to the limit within a window", () => {
    const now = 1_000_000;
    for (let i = 0; i < rule.limit; i += 1) {
      expect(checkRateLimit("k", rule, now).ok).toBe(true);
    }
  });

  it("rejects beyond the limit and reports a positive retry-after", () => {
    const now = 2_000_000;
    for (let i = 0; i < rule.limit; i += 1) {
      checkRateLimit("key", rule, now);
    }
    const decision = checkRateLimit("key", rule, now + 250);
    expect(decision).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it("resets after the window elapses", () => {
    const now = 3_000_000;
    for (let i = 0; i < rule.limit; i += 1) {
      checkRateLimit("reset", rule, now);
    }
    expect(checkRateLimit("reset", rule, now).ok).toBe(false);
    expect(checkRateLimit("reset", rule, now + rule.windowMs).ok).toBe(true);
  });

  it("keeps separate buckets per key", () => {
    const now = 4_000_000;
    for (let i = 0; i < rule.limit; i += 1) {
      checkRateLimit("a", rule, now);
    }
    expect(checkRateLimit("b", rule, now).ok).toBe(true);
    expect(checkRateLimit("a", rule, now).ok).toBe(false);
  });

  it("returns a 429 response with a Retry-After header", async () => {
    const response = rateLimitResponse(7);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("retry-after")).not.toBe("0");
    await expect(response.json()).resolves.toEqual({
      error: "rate limit exceeded",
    });
  });
});

describe("collector route rate limiting", () => {
  const request = () =>
    new Request("http://localhost/api/collectors/hn", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-rate-1" }),
      headers: { "content-type": "application/json" },
    });

  it("returns 429 with Retry-After once the budget is exhausted", async () => {
    for (let i = 0; i < 30; i += 1) {
      await handleCollectorPost(request(), hnCollector, "hn");
    }

    const response = await handleCollectorPost(request(), hnCollector, "hn");
    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("does not run the collector for a limited request", async () => {
    for (let i = 0; i < 31; i += 1) {
      await handleCollectorPost(request(), hnCollector, "hn");
    }
    expect(state.collectorRan).toBe(false);
  });
});
