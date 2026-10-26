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

  it.each([
    ["first_scan_completed", { status: "done" }, "success"],
    ["first_scan_completed", { status: "partial" }, "partial"],
    ["first_scan_failed", {}, "failed"],
  ] as const)("keeps %s status in scan_finished", async (activation, properties, status) => {
    captureProductEvent.mockClear();
    await captureActivation(activation, "workspace-123", properties);
    expect(captureProductEvent).toHaveBeenCalledWith({
      event: "scan_finished",
      workspaceId: "workspace-123",
      read: 0,
      relevant: 0,
      picked: 0,
      capped: false,
      status,
    });
  });
});
