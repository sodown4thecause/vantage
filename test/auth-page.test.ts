import { describe, expect, it, vi } from "vitest";

// Regression test for the 6 Oct 2026 incident: /auth/* returned 404 on the Worker
// because the page was prerendered and the Worker has no incremental cache.
vi.mock("@neondatabase/auth-ui", () => ({ AuthView: () => null }));
vi.mock("@neondatabase/auth-ui/server", () => ({
  authViewPaths: { SIGN_IN: "sign-in", SIGN_UP: "sign-up", CALLBACK: "callback" },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import AuthPage, * as page from "@/app/auth/[path]/page";

describe("/auth/[path] page", () => {
  it("is rendered per request, never prerendered", () => {
    expect(page.dynamic).toBe("force-dynamic");
    expect("generateStaticParams" in page).toBe(false);
    expect("dynamicParams" in page).toBe(false);
  });

  it("renders for known auth view paths", async () => {
    await expect(AuthPage({ params: Promise.resolve({ path: "sign-up" }) })).resolves.toBeTruthy();
    await expect(AuthPage({ params: Promise.resolve({ path: "sign-in" }) })).resolves.toBeTruthy();
  });

  it("404s for unknown paths", async () => {
    await expect(AuthPage({ params: Promise.resolve({ path: "nonsense" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AuthPage({ params: Promise.resolve({ path: "../etc" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
