import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createNeonAuth, getSession } = vi.hoisted(() => ({
  createNeonAuth: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth }));

describe("server auth session lookup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.com");
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "test-only-cookie-secret-at-least-32-characters");
    createNeonAuth.mockReturnValue({ getSession });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("treats malformed-cookie exceptions as signed out without logging cookie contents", async () => {
    getSession.mockRejectedValue(new Error("invalid cookie: private-cookie-value"));
    const { auth } = await import("@/lib/auth/server");

    await expect(auth.getSession()).resolves.toEqual({ data: null, error: null });
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      "auth.getSession failed; treating request as signed out",
    );
  });

  it.each(["NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET"])(
    "propagates missing %s configuration",
    async (name) => {
      vi.stubEnv(name, undefined);
      const { auth } = await import("@/lib/auth/server");

      await expect(auth.getSession()).rejects.toThrow(`Required environment variable ${name} is not configured`);
      expect(getSession).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
    },
  );

  it("propagates SDK construction errors such as an invalid cookie secret", async () => {
    const error = new Error("Cookie secret must be at least 32 characters");
    createNeonAuth.mockImplementation(() => { throw error; });
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "short");
    const { auth } = await import("@/lib/auth/server");

    await expect(auth.getSession()).rejects.toBe(error);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("logs returned SDK errors without changing the result or exposing its contents", async () => {
    const result = { data: null, error: { status: 502, message: "private details" } };
    getSession.mockResolvedValue(result);
    const { auth } = await import("@/lib/auth/server");

    await expect(auth.getSession()).resolves.toBe(result);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("auth.getSession returned an error");
  });

  it("preserves successful session results", async () => {
    const result = { data: { user: { id: "user-1" } }, error: null };
    getSession.mockResolvedValue(result);
    const { auth } = await import("@/lib/auth/server");

    await expect(auth.getSession()).resolves.toBe(result);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("defers construction until first use and keeps other methods bound to the client", async () => {
    const client = { getSession, handler: vi.fn(function (this: unknown) { return this; }) };
    createNeonAuth.mockReturnValue(client);
    const { auth } = await import("@/lib/auth/server");
    const lookup = auth.getSession;
    expect(createNeonAuth).not.toHaveBeenCalled();

    getSession.mockResolvedValue({ data: null, error: null });
    await lookup();
    expect(auth.handler()).toBe(client);
    expect(createNeonAuth).toHaveBeenCalledTimes(1);
  });
});
