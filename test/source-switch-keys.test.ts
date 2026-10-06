import { describe, expect, it } from "vitest";

import { BROWSER_RUN_SOURCE_KEY } from "@/lib/browser/run";
import { SOURCE_SWITCH_KEYS, isSourceSwitchKey } from "@/lib/sources/keys";

describe("source switch keys", () => {
  it("lets operators manage the Browser Run switch the wrapper checks", () => {
    expect(SOURCE_SWITCH_KEYS).toContain(BROWSER_RUN_SOURCE_KEY);
    expect(isSourceSwitchKey(BROWSER_RUN_SOURCE_KEY)).toBe(true);
  });

  it("still rejects unknown keys", () => {
    expect(isSourceSwitchKey("browser_hour")).toBe(false);
    expect(isSourceSwitchKey(undefined)).toBe(false);
  });
});
