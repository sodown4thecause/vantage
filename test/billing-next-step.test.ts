import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspace: null as { id: string; name: string } | null,
}));

vi.mock("@/lib/auth/workspace", () => ({ getCurrentWorkspace: async () => state.workspace }));

import { nextStepHref } from "@/lib/billing/next-step";

beforeEach(() => {
  state.workspace = null;
});

describe("nextStepHref after payment", () => {
  it("sends a user with no workspace home to create one", async () => {
    await expect(nextStepHref()).resolves.toBe("/");
  });

  it("sends a user with a workspace to the unified workspace, even before onboarding", async () => {
    state.workspace = { id: "ws 1", name: "Acme" };
    await expect(nextStepHref()).resolves.toBe("/workspace?workspaceId=ws%201");
  });
});
