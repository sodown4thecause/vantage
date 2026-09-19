import { describe, expect, it } from "vitest";

import { requiredEnv } from "@/lib/env/required";

describe("requiredEnv", () => {
  it("returns a configured value", () => {
    expect(requiredEnv("TOKEN", { TOKEN: "configured" })).toBe("configured");
  });

  it("throws a clear error for missing or blank values", () => {
    expect(() => requiredEnv("TOKEN", {})).toThrow(
      "Required environment variable TOKEN is not configured",
    );
    expect(() => requiredEnv("TOKEN", { TOKEN: "   " })).toThrow(
      "Required environment variable TOKEN is not configured",
    );
  });
});
