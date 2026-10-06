import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/public/guard", () => ({
  guardPublicRequest: vi.fn(async () => ({ ok: false, status: 503, code: "guard_unavailable" })),
}));

import { POST } from "@/app/api/public/ping/route";

describe("POST /api/public/ping", () => {
  it("returns only a stable error code when the guard rejects", async () => {
    const res = await POST(new Request("https://vantage.test/api/public/ping", { method: "POST" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "guard_unavailable" });
  });
});
