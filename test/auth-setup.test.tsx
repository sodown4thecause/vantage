import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCurrentWorkspace: vi.fn(),
  getLatestMonitoringProfile: vi.fn(),
  createWorkspaceForCurrentUser: vi.fn(),
  setCurrentWorkspace: vi.fn(),
  listOwnedWorkspaces: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ auth: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth/workspace", () => ({ getCurrentWorkspace: mocks.getCurrentWorkspace, setCurrentWorkspace: mocks.setCurrentWorkspace, listOwnedWorkspaces: mocks.listOwnedWorkspaces }));
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
import { PlanLimitError } from "@/lib/plans/types";
import WorkspacesPage from "@/app/workspaces/page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.getCurrentWorkspace.mockResolvedValue(null);
  mocks.getLatestMonitoringProfile.mockResolvedValue(null);
  mocks.createWorkspaceForCurrentUser.mockResolvedValue({ id: "workspace-1" });
  mocks.setCurrentWorkspace.mockResolvedValue(true);
  mocks.listOwnedWorkspaces.mockResolvedValue([]);
});

describe("workspace chooser", () => {
  it("does not list workspaces without a confirmed session", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    await expect(WorkspacesPage()).rejects.toThrow("REDIRECT:/setup");
    expect(mocks.listOwnedWorkspaces).not.toHaveBeenCalled();
  });

  it("offers creation to an authenticated account without workspaces", async () => {
    const html = renderToStaticMarkup(await WorkspacesPage());
    expect(html).toContain("You haven’t created a workspace yet.");
    expect(html).toContain("/setup?new=1");
  });

  it("lists owned workspaces and identifies the persisted selection", async () => {
    mocks.listOwnedWorkspaces.mockResolvedValue([{ id: "first", name: "First product" }, { id: "second", name: "Second product" }]);
    mocks.getCurrentWorkspace.mockResolvedValue({ id: "second", name: "Second product" });
    const html = renderToStaticMarkup(await WorkspacesPage());
    expect(html).toContain("First product");
    expect(html).toContain("Second product");
    expect(html.match(/Selected workspace/g)).toHaveLength(1);
  });
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

  it("allows existing owners to explicitly request an additional workspace", async () => {
    mocks.getCurrentWorkspace.mockResolvedValue({ id: "workspace-1", name: "Acme" });
    const html = renderToStaticMarkup(await SetupPage({ searchParams: Promise.resolve({ new: "1" }) }));
    expect(html).toContain("Create your workspace");
    expect(html).toContain('name="additional" value="true"');
    expect(mocks.getLatestMonitoringProfile).not.toHaveBeenCalled();
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

  it("explains the plan cap without leaking internal errors", async () => {
    mocks.createWorkspaceForCurrentUser.mockRejectedValue(new PlanLimitError("projects", 3, "internal detail"));
    const form = new FormData();
    form.set("name", "Acme");
    expect((await startWorkspace({ error: "" }, form)).error).toContain("workspace limit for your plan");
    expect(mocks.setCurrentWorkspace).not.toHaveBeenCalled();
  });

  it("creates through the existing authenticated action and redirects after success", async () => {
    const form = new FormData();
    form.set("name", "  Acme  ");
    form.set("ownerUserId", "someone-else");
    await expect(startWorkspace({ error: "" }, form)).rejects.toThrow("REDIRECT:/setup");
    expect(mocks.createWorkspaceForCurrentUser).toHaveBeenCalledExactlyOnceWith("Acme", false);
    expect(mocks.setCurrentWorkspace).toHaveBeenCalledExactlyOnceWith("workspace-1");
  });

  it("requests additional creation only through the same plan-capped action", async () => {
    const form = new FormData();
    form.set("name", "Product two");
    form.set("additional", "true");
    await expect(startWorkspace({ error: "" }, form)).rejects.toThrow("REDIRECT:/setup");
    expect(mocks.createWorkspaceForCurrentUser).toHaveBeenCalledExactlyOnceWith("Product two", true);
  });
});
