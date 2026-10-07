import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/public/guard", () => ({
  guardPublicRequest: vi.fn(async () => ({ ok: false, status: 503, code: "guard_unavailable" })),
}));

import { POST } from "@/app/api/public/ping/route";

beforeEach(() => vi.stubEnv("ENABLE_PUBLIC_PING", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/public/ping", () => {
  it("is a 404 unless explicitly enabled", async () => {
    vi.stubEnv("ENABLE_PUBLIC_PING", "");
    const res = await POST(new Request("https://vantage.test/api/public/ping", { method: "POST" }));
    expect(res.status).toBe(404);
  });

  it("returns only a stable error code when the guard rejects", async () => {
    const res = await POST(new Request("https://vantage.test/api/public/ping", { method: "POST" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "guard_unavailable" });
  });

  it("works on a production build when the flag is set (staging) and stays 404 without it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const on = await POST(new Request("https://vantage.test/api/public/ping", { method: "POST" }));
    expect(on.status).toBe(503); // reaches the guard (mocked to reject)
    vi.stubEnv("ENABLE_PUBLIC_PING", "");
    const off = await POST(new Request("https://vantage.test/api/public/ping", { method: "POST" }));
    expect(off.status).toBe(404);
  });
});
