import { describe, expect, it } from "vitest";

import { publicCollectorError } from "@/lib/collectors/errors";
import { UnsafeUrlError } from "@/lib/collectors/safeFetch";

describe("publicCollectorError", () => {
  it("explains fetch-policy rejections", () => {
    expect(
      publicCollectorError(
        new UnsafeUrlError("Rejected private or internal host: 127.0.0.1"),
      ),
    ).toMatch(/fetch policy/);
  });

  it("explains disabled fixture fallback", () => {
    expect(
      publicCollectorError(
        new Error("reddit: fixture fallback is disabled in production; set ALLOW_FIXTURES=true to override"),
      ),
    ).toMatch(/sample data is disabled/);
  });

  it("points at missing provider credentials", () => {
    expect(publicCollectorError(new Error("SCAVIO_API_KEY is not configured"))).toMatch(
      /credential/,
    );
  });

  it("reports unreachable providers without leaking internals", () => {
    expect(publicCollectorError(new Error("fetch failed"))).toMatch(
      /could not be reached/,
    );
    expect(
      publicCollectorError(new TypeError("fetch failed")),
    ).not.toMatch(/fetch failed/);
  });

  it("falls back to the generic collector failure", () => {
    expect(publicCollectorError(new Error("boom at 10.0.0.5"))).toBe(
      "collector failed",
    );
    expect(publicCollectorError("weird")).toBe("collector failed");
  });
});
