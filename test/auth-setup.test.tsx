import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCurrentWorkspace: vi.fn(),
  getLatestMonitoringProfile: vi.fn(),
  createWorkspaceForCurrentUser: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ auth: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth/workspace", () => ({ getCurrentWorkspace: mocks.getCurrentWorkspace }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: mocks.getLatestMonitoringProfile }));
vi.mock("@/lib/db/actions", () => ({ createWorkspaceForCurrentUser: mocks.createWorkspaceForCurrentUser }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/components/shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageHead: ({ title, lede }: { title: string; lede: string }) => <><h1>{title}</h1><p>{lede}</p></>,
}));

import SetupPage, { dynamic, metadata } from "@/app/setup/page";
import { startWorkspace } from "@/app/setup/actions";
import { PRIVATE_PATHS } from "@/lib/seo";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.getCurrentWorkspace.mockResolvedValue(null);
  mocks.getLatestMonitoringProfile.mockResolvedValue(null);
  mocks.createWorkspaceForCurrentUser.mockResolvedValue({ id: "workspace-1" });
});

describe("post-login setup", () => {
  it("is dynamic and excluded from indexing", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.robots.index).toBe(false);
    expect(PRIVATE_PATHS).toContain("/setup");
  });
  it("shows a recovery screen instead of silently returning a missing session to marketing", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    const html = renderToStaticMarkup(await SetupPage());
    expect(html).toContain("confirm your sign-in");
    expect(html).toContain("/auth/sign-in");
    expect(html).not.toContain('name="name"');
    expect(mocks.getCurrentWorkspace).not.toHaveBeenCalled();
  });

  it("gives new users a dedicated workspace form without creating anything on GET", async () => {
    const html = renderToStaticMarkup(await SetupPage());
    expect(html).toContain("Create your workspace");
    expect(html).toContain('name="name"');
    expect(mocks.createWorkspaceForCurrentUser).not.toHaveBeenCalled();
  });

  it.each([[null, "onboarding"], [{ id: "profile-1" }, "queue"]])(
    "routes an existing owner according to monitoring-profile readiness",
    async (profile, destination) => {
      mocks.getCurrentWorkspace.mockResolvedValue({ id: "workspace-1", name: "Acme" });
      mocks.getLatestMonitoringProfile.mockResolvedValue(profile);
      await expect(SetupPage()).rejects.toThrow(`REDIRECT:/${destination}?workspaceId=workspace-1`);
      expect(mocks.getLatestMonitoringProfile).toHaveBeenCalledWith("workspace-1");
      expect(mocks.createWorkspaceForCurrentUser).not.toHaveBeenCalled();
    },
  );

  it("refuses a direct unauthenticated form submission before any write", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    const form = new FormData();
    form.set("name", "Acme");
    expect(await startWorkspace({ error: "" }, form)).toEqual({ error: "Your session has expired. Sign in again to continue." });
    expect(mocks.createWorkspaceForCurrentUser).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "x".repeat(101)])("validates workspace names on the server", async (name) => {
    const form = new FormData();
    form.set("name", name);
    expect((await startWorkspace({ error: "" }, form)).error).toContain("1–100 characters");
    expect(mocks.createWorkspaceForCurrentUser).not.toHaveBeenCalled();
  });

  it("shows a safe, retryable error when creation fails", async () => {
    mocks.createWorkspaceForCurrentUser.mockRejectedValue(new Error("private database details"));
    const form = new FormData();
    form.set("name", "Acme");
    const result = await startWorkspace({ error: "" }, form);
    expect(result.error).toContain("try again");
    expect(result.error).not.toContain("private database details");
  });

  it("creates through the existing authenticated action and redirects after success", async () => {
    const form = new FormData();
    form.set("name", "  Acme  ");
    form.set("ownerUserId", "someone-else");
    await expect(startWorkspace({ error: "" }, form)).rejects.toThrow("REDIRECT:/onboarding?workspaceId=workspace-1");
    expect(mocks.createWorkspaceForCurrentUser).toHaveBeenCalledExactlyOnceWith("Acme");
  });
});
