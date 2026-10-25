import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(), values: vi.fn(), conflict: vi.fn(), execute: vi.fn(), examples: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({ insert: mocks.insert, execute: mocks.execute }) }));
vi.mock("@/lib/public/hero-examples", () => ({ approvedHeroExamples: mocks.examples }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: {} }) }));

import { POST } from "@/app/api/public/leads/route";
import { publicProductLead } from "@/lib/db/schema";

function request(body: unknown = { email: " Buyer@Example.com ", product: " An SDK for agents " }, headers: Record<string, string> = {}) {
  return new Request("https://vantage.test/api/public/leads", {
    method: "POST",
    headers: { origin: "https://vantage.test", "content-type": "application/json", "x-turnstile-token": "synthetic-token", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TURNSTILE_SECRET_KEY", "synthetic-secret");
  vi.stubEnv("TURNSTILE_DEV_BYPASS", "true");
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({ onConflictDoNothing: mocks.conflict });
  mocks.conflict.mockResolvedValue([]);
  mocks.execute.mockResolvedValue({ rows: [{ scans: 1, spent_usd: 0 }] });
  mocks.examples.mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ success: true })));
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("public capture with real server Turnstile guard", () => {
  it("rejects missing tokens without siteverify, database writes or examples", async () => {
    expect((await POST(request(undefined, { "x-turnstile-token": " " }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.examples).not.toHaveBeenCalled();
  });

  it("rejects bad tokens using siteverify before any database access or reveal", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ success: false }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "turnstile_failed" });
    expect(fetch).toHaveBeenCalledWith("https://challenges.cloudflare.com/turnstile/v0/siteverify", expect.objectContaining({ method: "POST" }));
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("secret")).toBe("synthetic-secret");
    expect(body.get("response")).toBe("synthetic-token");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.examples).not.toHaveBeenCalled();
  });

  it("cannot use the development bypass on this endpoint", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.examples).not.toHaveBeenCalled();
  });

  it.each(["network", "http", "malformed"])("fails closed on siteverify %s failure", async (failure) => {
    if (failure === "network") vi.mocked(fetch).mockRejectedValue(new Error("synthetic outage"));
    if (failure === "http") vi.mocked(fetch).mockResolvedValue(new Response("", { status: 503 }));
    if (failure === "malformed") vi.mocked(fetch).mockResolvedValue(new Response("not json"));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.examples).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and invalid input without network or storage", async () => {
    expect((await POST(request(undefined, { origin: "https://other.test" }))).status).toBe(403);
    expect((await POST(request(undefined, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request({ email: "bad", product: "SDK" }))).status).toBe(400);
    expect((await POST(request({ email: "a@example.com", product: "x" }))).status).toBe(400);
    expect((await POST(request({ email: "a@example.com", product: "x".repeat(13000) }))).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("dedupes normalised emails, stores no workspace data, sends nothing and reveals only after verification", async () => {
    for (let n = 0; n < 2; n++) {
      const response = await POST(request({ email: " Buyer@Example.com ", product: " An SDK for agents ", workspaceId: "private" }));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ ok: true, examples: [] });
    }
    expect(mocks.insert).toHaveBeenCalledWith(publicProductLead);
    expect(mocks.values).toHaveBeenCalledWith({ email: "buyer@example.com", productDescription: "An SDK for agents" });
    expect(mocks.conflict).toHaveBeenCalledWith({ target: publicProductLead.email });
    expect(vi.mocked(fetch).mock.invocationCallOrder[0]).toBeLessThan(mocks.insert.mock.invocationCallOrder[0]);
    expect(mocks.insert.mock.invocationCallOrder[0]).toBeLessThan(mocks.examples.mock.invocationCallOrder[0]);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(fetch).mock.calls) expect(call[0]).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
  });

  it("returns approved examples without echoing the email or product", async () => {
    const examples = [{ platform: "reddit", community: "r/synthetic", title: "Synthetic question", sourceUrl: "https://example.com/thread", excerpt: "Synthetic quote", postedAt: "2026-10-20T00:00:00.000Z" }];
    mocks.examples.mockResolvedValue(examples);
    expect(await (await POST(request())).json()).toEqual({ ok: true, examples });
  });

  it("does not disclose database errors or reveal examples after a storage failure", async () => {
    mocks.conflict.mockRejectedValue(new Error("private connection details"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "capture_unavailable" });
    expect(mocks.examples).not.toHaveBeenCalled();
  });
});
