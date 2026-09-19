import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { contentHash } from "@/lib/collectors/hash";
import { hnCollector } from "@/lib/collectors/hn";

type Fixture = {
  algoliaHit: {
    objectID: string;
    title: string;
    author: string;
    created_at_i: number;
  };
  firebaseStory: {
    id: number;
    type: string;
    by: string;
    time: number;
    title: string;
    text: string;
    url: string;
  };
};

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "test/fixtures/hn.json"), "utf8"),
) as Fixture;

const context = {
  workspaceId: "workspace-1",
  sourceId: "source-1",
  config: { queries: ["launch"] },
  cursor: "1699999999",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("hnCollector", () => {
  it("normalizes a validated Firebase story with full item content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (url.hostname === "hn.algolia.com") {
          return Response.json({ hits: [fixture.algoliaHit], nbHits: 1, nbPages: 1 });
        }
        return Response.json(fixture.firebaseStory);
      }),
    );
    vi.setSystemTime(new Date("2023-11-14T22:13:30.000Z"));

    const result = await hnCollector.run(context);

    const contentMd = "# Firebase title\n\nFull story body";
    expect(result.documents).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-1",
        sourceId: "source-1",
        urlCanonical: "https://example.com/full-story",
        platform: "hn",
        authorRef: "firebase-user",
        title: "Firebase title",
        postedAt: new Date("2023-11-14T22:13:21.000Z"),
        contentMd,
        contentHash: contentHash("hn", "https://example.com/full-story", contentMd),
        rawSnapshotRef: "hn:123",
      }),
    ]);
    expect(result.nextState).toEqual({ cursor: "1700000010" });
  });

  it("skips deleted, dead, missing, and malformed Firebase items", async () => {
    const hits = ["deleted", "dead", "missing", "invalid", "valid"].map(
      (objectID) => ({ ...fixture.algoliaHit, objectID }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (url.hostname === "hn.algolia.com") {
          return Response.json({ hits, nbHits: hits.length, nbPages: 1 });
        }
        if (url.pathname.endsWith("deleted.json")) return Response.json({ deleted: true });
        if (url.pathname.endsWith("dead.json")) return Response.json({ ...fixture.firebaseStory, dead: true });
        if (url.pathname.endsWith("missing.json")) return Response.json(null);
        if (url.pathname.endsWith("invalid.json")) return Response.json({ id: "invalid", type: "story" });
        return Response.json(fixture.firebaseStory);
      }),
    );

    const result = await hnCollector.run(context);

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({ rawSnapshotRef: "hn:valid" });
  });

  it("splits an Algolia range before the 1,000-hit cap can omit stories", async () => {
    vi.setSystemTime(new Date(1_100_000));
    const searchRanges: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (url.hostname === "hn.algolia.com") {
          const range = url.searchParams.get("numericFilters") ?? "";
          searchRanges.push(range);
          if (range === "created_at_i>=1000,created_at_i<=1100") {
            return Response.json({ hits: [], nbHits: 1000, nbPages: 10 });
          }
          if (range === "created_at_i>=1000,created_at_i<=1050") {
            return Response.json({
              hits: [fixture.algoliaHit],
              nbHits: 1,
              nbPages: 1,
            });
          }
          return Response.json({ hits: [], nbHits: 0, nbPages: 0 });
        }
        return Response.json(fixture.firebaseStory);
      }),
    );

    const result = await hnCollector.run({ ...context, cursor: "1000" });

    expect(searchRanges).toEqual([
      "created_at_i>=1000,created_at_i<=1100",
      "created_at_i>=1000,created_at_i<=1050",
      "created_at_i>=1051,created_at_i<=1100",
    ]);
    expect(result.documents).toHaveLength(1);
  });

  it("surfaces a Firebase HTTP failure instead of returning a partial result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (url.hostname === "hn.algolia.com") {
          return Response.json({ hits: [fixture.algoliaHit], nbHits: 1, nbPages: 1 });
        }
        return new Response(null, { status: 503 });
      }),
    );

    await expect(hnCollector.run(context)).rejects.toThrow("Firebase HN error 503");
  });
});
