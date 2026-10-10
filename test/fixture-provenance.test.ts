import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fixturePosts: true,
}));

vi.mock("@/lib/reddit/client", () => ({
  fetchRedditPostsWithMeta: async () => ({
    posts: state.fixturePosts
      ? [
          {
            id: "fixture-1",
            url: "https://reddit.com/r/test/fixture-1",
            title: "Fixture post",
            body: "Fixture body",
            author: "fixture-user",
            subreddit: "test",
            score: 1,
            numComments: 0,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        ]
      : [],
    meta: { provider: state.fixturePosts ? "fixture" : "scavio" },
    cursor: undefined,
  }),
}));

import { redditCollector } from "@/lib/collectors/reddit";
import {
  assertRealProvider,
  fixturesAllowed,
  isFixtureProvider,
} from "@/lib/collectors/provenance";

const ctx = {
  workspaceId: "workspace-1",
  sourceId: "source-1",
  config: {} as Record<string, unknown>,
  cursor: null as string | null,
  signal: undefined as AbortSignal | undefined,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fixture provenance", () => {
  it("identifies the fixture provider", () => {
    expect(isFixtureProvider("fixture")).toBe(true);
    expect(isFixtureProvider("scavio")).toBe(false);
    expect(isFixtureProvider("tinyfish_search")).toBe(false);
  });

  it("allows fixtures outside production", () => {
    expect(fixturesAllowed({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(
      true,
    );
    expect(fixturesAllowed({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("blocks fixtures in production unless explicitly opted in", () => {
    expect(fixturesAllowed({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(
      false,
    );
    expect(
      fixturesAllowed({
        NODE_ENV: "production",
        ALLOW_FIXTURES: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      fixturesAllowed({
        NODE_ENV: "production",
        ALLOW_FIXTURES: "false",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it.each(["", "TRUE", "1", "yes", " true "])(
    "does not accept invalid production ALLOW_FIXTURES value %s",
    (allowFixtures) => {
      const env = { NODE_ENV: "production", ALLOW_FIXTURES: allowFixtures } as NodeJS.ProcessEnv;
      expect(fixturesAllowed(env)).toBe(false);
      expect(() => assertRealProvider({ provider: "fixture" }, "reddit", env))
        .toThrow(/fixture fallback is disabled in production/);
    },
  );

  it("never blocks real provider data, even in production", () => {
    expect(() =>
      assertRealProvider({ provider: "scavio" }, "reddit", {
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it("throws for fixture data in production without an override", () => {
    expect(() =>
      assertRealProvider({ provider: "fixture" }, "reddit", {
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toThrow(/fixture fallback is disabled in production/);
  });

  it("keeps reddit documents marked as mocked outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = await redditCollector.run(ctx);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.metadata).toMatchObject({
      provider: "fixture",
      mocked: true,
    });
  });

  it("fails the reddit collector in production rather than storing samples", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(redditCollector.run(ctx)).rejects.toThrow(
      /fixture fallback is disabled in production/,
    );
  });

  it("returns honestly mocked fixture documents with explicit production opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FIXTURES", "true");
    const result = await redditCollector.run(ctx);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.metadata).toMatchObject({
      provider: "fixture",
      mocked: true,
    });
  });
});
