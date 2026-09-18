import { afterEach, describe, expect, it, vi } from "vitest";

import { rssCollector } from "@/lib/collectors/rss";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rssCollector conditional requests", () => {
  it("returns no documents and echoes validators on HTTP 304", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 304 })));

    const result = await rssCollector.run({
      workspaceId: "workspace-1",
      sourceId: "source-1",
      config: { feedUrl: "https://example.com/feed.xml" },
      etag: '"etag-1"',
      lastModified: "Wed, 17 Sep 2026 00:00:00 GMT",
    });

    expect(result).toEqual({
      documents: [],
      nextState: {
        etag: '"etag-1"',
        lastModified: "Wed, 17 Sep 2026 00:00:00 GMT",
      },
    });
  });
});
