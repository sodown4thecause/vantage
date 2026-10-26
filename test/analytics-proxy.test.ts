import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "@/next.config";

afterEach(() => vi.unstubAllEnvs());

describe("PostHog ingestion proxy", () => {
  it("defaults the app ingestion prefix to the US PostHog API host", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    const rewrites = await nextConfig.rewrites?.();
    expect(rewrites).toContainEqual({
      source: "/ingest/:path*",
      destination: "https://us.i.posthog.com/:path*",
    });
  });

  it("keeps browser ingestion in the configured EU PostHog region", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com/");
    const rewrites = await nextConfig.rewrites?.();
    expect(rewrites).toContainEqual({
      source: "/ingest/:path*",
      destination: "https://eu.i.posthog.com/:path*",
    });
  });
});
