import { afterEach, describe, expect, it, vi } from "vitest";

import { appUrl } from "@/lib/app-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appUrl", () => {
  it("keeps staging digest links on the configured origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", " https://staging.example.com/// ");

    expect(appUrl()).toBe("https://staging.example.com");
  });

  it("refuses a deployed digest origin when configuration is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "  ");

    expect(() => appUrl()).toThrow("NEXT_PUBLIC_APP_URL");
  });

  it("uses localhost only outside production mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);

    expect(appUrl()).toBe("http://localhost:3000");
  });
});
