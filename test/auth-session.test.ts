import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getSession: (async () => ({ data: null, error: null })) as () => Promise<unknown>,
  createThrows: false,
}));

vi.mock("@neondatabase/auth/next/server", () => ({
  createNeonAuth: () => {
    if (state.createThrows) throw new Error("cookie secret must be at least 32 characters");
    return { getSession: () => state.getSession() };
  },
}));

const ENV = { NEON_AUTH_BASE_URL: "https://auth.example.test", NEON_AUTH_COOKIE_SECRET: "x".repeat(32) };

beforeEach(() => {
  vi.resetModules();
  Object.assign(process.env, ENV);
  state.createThrows = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth.getSession", () => {
  it("treats a throwing session check (bad cookie) as signed out", async () => {
    state.getSession = async () => {
      throw new Error("invalid session_data cookie");
    };
    const { auth } = await import("@/lib/auth/server");
    await expect(auth.getSession()).resolves.toMatchObject({ data: null });
    expect(console.warn).toHaveBeenCalled();
  });

  it("passes a valid session through", async () => {
    state.getSession = async () => ({ data: { user: { id: "u1" } }, error: null });
    const { auth } = await import("@/lib/auth/server");
    await expect(auth.getSession()).resolves.toMatchObject({ data: { user: { id: "u1" } } });
  });

  it("logs an error object returned by Neon Auth (e.g. outage)", async () => {
    state.getSession = async () => ({ data: null, error: { message: "unreachable" } });
    const { auth } = await import("@/lib/auth/server");
    await expect(auth.getSession()).resolves.toMatchObject({ data: null });
    expect(console.error).toHaveBeenCalled();
  });

  it("still fails loudly on a setup mistake", async () => {
    state.createThrows = true;
    const { auth } = await import("@/lib/auth/server");
    await expect(auth.getSession()).rejects.toThrow(/cookie secret/);
  });

  it("still fails loudly when env is missing", async () => {
    delete process.env.NEON_AUTH_COOKIE_SECRET;
    const { auth } = await import("@/lib/auth/server");
    await expect(auth.getSession()).rejects.toThrow();
  });
});
