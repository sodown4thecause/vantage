import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "@/next.config";

afterEach(() => vi.unstubAllEnvs());

/** The config returns beforeFiles/afterFiles groups; the proxy lives in afterFiles. */
async function afterFiles() {
  const rewrites = await nextConfig.rewrites?.();
  if (Array.isArray(rewrites)) return rewrites;
  return rewrites?.afterFiles ?? [];
}

describe("PostHog ingestion proxy", () => {
  it("defaults the app ingestion prefix to the US PostHog API host", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    expect(await afterFiles()).toContainEqual({
      source: "/ingest/:path*",
      destination: "https://us.i.posthog.com/:path*",
    });
  });

  it("keeps browser ingestion in the configured EU PostHog region", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com/");
    expect(await afterFiles()).toContainEqual({
      source: "/ingest/:path*",
      destination: "https://eu.i.posthog.com/:path*",
    });
  });
});
