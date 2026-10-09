import { describe, expect, it } from "vitest";

import { appUrl } from "@/lib/app-url";

describe("appUrl", () => {
  it("uses the configured origin and strips trailing slashes", () => {
    expect(appUrl({ NEXT_PUBLIC_APP_URL: "https://app.contextfor.dev/" })).toBe(
      "https://app.contextfor.dev",
    );
  });

  it("falls back to the production origin outside development", () => {
    expect(appUrl({ NODE_ENV: "production" })).toBe("https://app.contextfor.dev");
  });

  it("falls back to localhost in development", () => {
    expect(appUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(appUrl({})).toBe("http://localhost:3000");
  });
});
