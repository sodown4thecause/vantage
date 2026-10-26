import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

describe("PostHog ingestion proxy", () => {
  it("rewrites the app ingestion prefix to the US PostHog API host", async () => {
    const rewrites = await nextConfig.rewrites?.();
    expect(rewrites).toContainEqual({
      source: "/ingest/:path*",
      destination: "https://us.i.posthog.com/:path*",
    });
  });
});
