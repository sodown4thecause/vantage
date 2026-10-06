import { describe, expect, it } from "vitest";

import { safeHttpUrl } from "@/lib/http/safe-url";

describe("safeHttpUrl", () => {
  it("keeps http and https URLs", () => {
    expect(safeHttpUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHttpUrl("http://example.com/")).toBe("http://example.com/");
  });

  it("rejects script, data, file and malformed values", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "file:///etc/passwd", "//evil.com", "not a url", "", null, undefined]) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
  });
});
