import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  conflict: vi.fn(),
}));

vi.mock("@/lib/public/guard", () => ({ guardPublicRequest: mocks.guard }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ insert: mocks.insert }) }));

import { POST } from "@/app/api/public/leads/route";
import { publicProductLead } from "@/lib/db/schema";

function request(body: unknown = { email: " Buyer@Example.com ", product: " An SDK for AI agents " }, headers: Record<string, string> = {}) {
  return new Request("https://vantage.test/api/public/leads", {
    method: "POST",
    headers: { origin: "https://vantage.test", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true });
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({ onConflictDoNothing: mocks.conflict });
  mocks.conflict.mockResolvedValue([]);
});

describe("public product interest capture", () => {
  it("rejects cross-origin requests before any guard or write", async () => {
    expect((await POST(request(undefined, { origin: "https://other.test" }))).status).toBe(403);
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("requires JSON and rejects malformed and oversized input", async () => {
    expect((await POST(request(undefined, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request({ email: "bad", product: "SDK" }))).status).toBe(400);
    expect((await POST(request({ email: "a@example.com", product: "x" }))).status).toBe(400);
    expect((await POST(request({ email: "a@example.com", product: "x".repeat(2001) }))).status).toBe(400);
    expect((await POST(request({ email: "a@example.com", product: "x".repeat(13000) }))).status).toBe(413);
    const malformed = request();
    vi.spyOn(malformed, "text").mockResolvedValue("{");
    expect((await POST(malformed)).status).toBe(400);
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([403, 429, 503])("does not store a lead when the public guard returns %s", async (status) => {
    mocks.guard.mockResolvedValue({ ok: false, status, code: "guard_unavailable" });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("guards before inserting only email and product, without accepting a workspace ID", async () => {
    const req = request({ email: " Buyer@Example.com ", product: " An SDK for AI agents ", workspaceId: "someone-else" });
    const response = await POST(req);
    expect(mocks.guard).toHaveBeenCalledWith(req, { action: "product_lead", costEstimateUsd: 0, perVisitorPerDay: 5 });
    expect(mocks.insert).toHaveBeenCalledWith(publicProductLead);
    expect(mocks.values).toHaveBeenCalledWith({ email: "buyer@example.com", productDescription: "An SDK for AI agents" });
    expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(mocks.insert.mock.invocationCallOrder[0]);
    expect(mocks.conflict).toHaveBeenCalledWith({ target: publicProductLead.email });
    expect(await response.json()).toEqual({ ok: true });
  });

  it("does not reveal whether an email was already registered", async () => {
    mocks.conflict.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "new" }]);
    expect(await (await POST(request())).json()).toEqual(await (await POST(request())).json());
  });

  it("does not disclose database errors or the supplied email", async () => {
    mocks.conflict.mockRejectedValueOnce(new Error("private database details"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "capture_unavailable" });
  });
});
