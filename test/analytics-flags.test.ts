import { describe, expect, it, vi } from "vitest";

const { isFeatureEnabled: checkFlag } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { isFeatureEnabled: checkFlag } }));

import { isFeatureEnabled } from "@/lib/analytics/feature-flags";

describe("typed PostHog feature flag helper", () => {
  it("returns false while flags load and for unknown/blank names", () => {
    checkFlag.mockReturnValue(undefined);
    expect(isFeatureEnabled("future-flag")).toBe(false);
    expect(isFeatureEnabled("   ")).toBe(false);
    expect(checkFlag).toHaveBeenCalledTimes(1);
  });

  it("returns true only for an enabled flag", () => {
    checkFlag.mockReturnValue(true);
    expect(isFeatureEnabled("future-flag")).toBe(true);
  });
});
