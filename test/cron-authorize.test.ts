import { describe, expect, it } from "vitest";

import { isCronAuthorized } from "@/lib/cron/authorize";

describe("isCronAuthorized", () => {
  it("fails closed in production when CRON_SECRET is missing", () => {
    expect(
      isCronAuthorized(new Request("https://example.com"), {
        nodeEnv: "production",
      }),
    ).toBe(false);
  });

  it("requires the matching bearer token when a secret is configured", () => {
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer correct" },
    });
    expect(
      isCronAuthorized(request, {
        nodeEnv: "production",
        secret: "correct",
      }),
    ).toBe(true);
    expect(
      isCronAuthorized(request, {
        nodeEnv: "production",
        secret: "wrong",
      }),
    ).toBe(false);
  });
});
