import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

// Next compiles route sources with its bundled path-to-regexp; using the same copy keeps this test honest.
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (source: string, keys?: unknown[]) => RegExp;
};

describe("next.config trailing-slash and PostHog proxy routes", () => {
  it("still 308s trailing-slash URLs to the slash-less path, except under /lumen/", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toHaveLength(1);
    const [redirect] = redirects;
    expect(redirect).toMatchObject({ destination: "/:path", permanent: true });

    const matches = (path: string) => pathToRegexp(redirect.source).test(path);
    for (const path of ["/pricing/", "/blog/some-post/", "/blog/", "/api/billing/portal/", "/lumenx/", "/blog/lumen/"]) {
      expect(matches(path), path).toBe(true);
    }
    for (const path of ["/", "/pricing", "/blog/some-post", "/lumen/", "/lumen/e/", "/lumen/flags/"]) {
      expect(matches(path), path).toBe(false);
    }
  });

  it("proxies /lumen to the PostHog ingestion and assets hosts", async () => {
    const rewrites = await nextConfig.rewrites!();
    expect(rewrites).toEqual([
      { source: "/lumen/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/lumen/array/:path*", destination: "https://us-assets.i.posthog.com/array/:path*" },
      { source: "/lumen/:path*", destination: "https://us.i.posthog.com/:path*" },
    ]);
  });
});
