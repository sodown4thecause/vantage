import { describe, expect, it } from "vitest";

import {
  SOURCE_TYPE_VALUES,
  isSourceType,
  validateSourceConfig,
} from "@/lib/collectors/config";

describe("isSourceType", () => {
  it("accepts known collector types only", () => {
    expect(isSourceType("rss")).toBe(true);
    expect(isSourceType("youtube")).toBe(true);
    expect(isSourceType("twitter")).toBe(false);
    expect(isSourceType(42)).toBe(false);
    expect(SOURCE_TYPE_VALUES).toContain("producthunt");
  });
});

describe("validateSourceConfig", () => {
  it("accepts a public RSS feed URL", () => {
    const result = validateSourceConfig("rss", {
      feedUrl: " https://example.com/feed.xml ",
    });
    expect(result).toEqual({ ok: true, config: { feedUrl: "https://example.com/feed.xml" } });
  });

  it("rejects RSS feeds on private or non-web addresses", () => {
    for (const feedUrl of [
      "http://localhost/feed.xml",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/feed.xml",
      "file:///etc/passwd",
    ]) {
      expect(validateSourceConfig("rss", { feedUrl }).ok, feedUrl).toBe(false);
    }
  });

  it("requires a feed URL or publication for Substack", () => {
    expect(validateSourceConfig("substack", {}).ok).toBe(false);
    expect(
      validateSourceConfig("substack", { publication: "acme" }),
    ).toEqual({ ok: true, config: { publication: "acme" } });
    expect(
      validateSourceConfig("substack", { feedUrl: "https://acme.substack.com/feed" })
        .ok,
    ).toBe(true);
  });

  it("requires a query for query-driven collectors", () => {
    for (const type of ["hn", "reddit", "x", "web_search"] as const) {
      expect(validateSourceConfig(type, {}).ok, type).toBe(false);
      expect(validateSourceConfig(type, { query: "  looking for crm  " })).toEqual({
        ok: true,
        config: { query: "looking for crm" },
      });
    }
  });

  it("requires video IDs or a query for YouTube", () => {
    expect(validateSourceConfig("youtube", {}).ok).toBe(false);
    expect(
      validateSourceConfig("youtube", { videoIds: "abc123, def456" }),
    ).toEqual({ ok: true, config: { videoIds: ["abc123", "def456"] } });
    expect(validateSourceConfig("youtube", { query: "saas review" })).toEqual({
      ok: true,
      config: { query: "saas review" },
    });
  });

  it("keeps optional collector config optional", () => {
    expect(validateSourceConfig("producthunt", {})).toEqual({
      ok: true,
      config: {},
    });
    expect(validateSourceConfig("other", { anything: "x" })).toEqual({
      ok: true,
      config: {},
    });
  });
});
