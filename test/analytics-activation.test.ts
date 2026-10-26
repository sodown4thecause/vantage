import { describe, expect, it, vi } from "vitest";

const { captureProductEvent } = vi.hoisted(() => ({ captureProductEvent: vi.fn() }));
vi.mock("@/lib/analytics/server", () => ({ captureProductEvent }));

import { captureActivation } from "@/lib/analytics/activation";

describe("activation funnel events", () => {
  it.each([
    ["signup", "signed_up"],
    ["url_confirmed", "profile_confirmed"],
  ] as const)("maps %s to %s", async (activation, event) => {
    captureProductEvent.mockClear();
    await captureActivation(activation, "workspace-123");
    expect(captureProductEvent).toHaveBeenCalledWith({ event, workspaceId: "workspace-123" });
  });
});
