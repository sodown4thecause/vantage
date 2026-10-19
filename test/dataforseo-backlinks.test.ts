import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runDataForSeo: vi.fn(), peekDataForSeo: vi.fn() }));
vi.mock("@/lib/dataforseo/gate", () => ({
  runDataForSeo: mocks.runDataForSeo,
  peekDataForSeo: mocks.peekDataForSeo,
}));

import {
  fetchAnchors,
  fetchBacklinkSummary,
  fetchReferringDomains,
  normalizeTarget,
  peekBacklinkReport,
  referringDomainGap,
  summaryTask,
  referringDomainsTask,
  anchorsTask,
  trimAnchors,
  trimReferringDomains,
  trimSummary,
  type ReferringDomain,
} from "@/lib/dataforseo/backlinks";

const TTL = 604_800;
const now = new Date("2026-10-19T12:00:00.000Z");

beforeEach(() => {
  mocks.runDataForSeo.mockReset();
  mocks.peekDataForSeo.mockReset();
});

describe("normalizeTarget", () => {
  it.each([
    ["https://www.Example.com/pricing?x=1", "example.com"],
    ["blog.example.co.uk", "blog.example.co.uk"],
    ["EXAMPLE.com.", "example.com"],
    ["  example.com  ", "example.com"],
    ["www.example.com", "example.com"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeTarget(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "localhost",
    "127.0.0.1",
    "http://10.0.0.1",
    "[::1]",
    "a b.com",
    "printer.local",
    "foo.localhost",
    "api.internal",
    "example",
    "-bad.com",
    "a..b.com",
    `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`,
  ])("rejects %j", (input) => {
    expect(normalizeTarget(input)).toBeNull();
  });
});

describe("trimSummary", () => {
  const providerSummary = {
    target: "example.com",
    rank: 512,
    backlinks: 12840,
    referring_domains: 310,
    referring_main_domains: 290,
    broken_backlinks: 42,
    backlinks_spam_score: 7,
    first_seen: "2019-03-14 09:12:00 +00:00",
    external_links_count: 99,
    crawled_pages: 1200,
  };

  it("copies only the fields the page reads", () => {
    expect(trimSummary([providerSummary])).toEqual({
      target: "example.com",
      rank: 512,
      backlinks: 12840,
      referringDomains: 310,
      referringMainDomains: 290,
      brokenBacklinks: 42,
      spamScore: 7,
      firstSeen: "2019-03-14 09:12:00 +00:00",
    });
  });

  it("zeroes missing or non-numeric fields and nulls missing strings", () => {
    expect(trimSummary([{ target: 5, rank: "512", backlinks: Number.NaN, referring_domains: { n: 1 } }])).toEqual({
      target: "",
      rank: 0,
      backlinks: 0,
      referringDomains: 0,
      referringMainDomains: 0,
      brokenBacklinks: 0,
      spamScore: 0,
      firstSeen: null,
    });
  });

  it("returns zeroed numbers and an empty target for an empty result", () => {
    expect(trimSummary([])).toEqual({
      target: "",
      rank: 0,
      backlinks: 0,
      referringDomains: 0,
      referringMainDomains: 0,
      brokenBacklinks: 0,
      spamScore: 0,
      firstSeen: null,
    });
  });
});

describe("trimReferringDomains", () => {
  it("maps items and drops any item without a string domain", () => {
    const result = [{
      target: "example.com",
      total_count: 3,
      items_count: 3,
      items: [
        {
          type: "backlinks_referring_domain",
          domain: "Blog.Alpha.io",
          rank: 410,
          backlinks: 12,
          first_seen: "2021-05-02 10:00:00 +00:00",
          lost_date: null,
          backlinks_spam_score: 2,
          tld: "io",
        },
        { type: "backlinks_referring_domain", rank: 120, backlinks: 3 },
        { type: "backlinks_referring_domain", domain: 42, rank: 99, backlinks: 1 },
        {
          type: "backlinks_referring_domain",
          domain: "news.beta.dev",
          rank: 88,
          backlinks: 5,
          first_seen: "2023-01-10 08:30:00 +00:00",
          backlinks_spam_score: 0,
        },
      ],
    }];

    expect(trimReferringDomains(result)).toEqual([
      { domain: "Blog.Alpha.io", rank: 410, backlinks: 12, spamScore: 2, firstSeen: "2021-05-02 10:00:00 +00:00" },
      { domain: "news.beta.dev", rank: 88, backlinks: 5, spamScore: 0, firstSeen: "2023-01-10 08:30:00 +00:00" },
    ]);
  });

  it("returns an empty list when there are no items or no result", () => {
    expect(trimReferringDomains([])).toEqual([]);
    expect(trimReferringDomains([{ target: "example.com", items: "nope" }])).toEqual([]);
  });
});

describe("trimAnchors", () => {
  it("maps items and drops any item without a string anchor", () => {
    const result = [{
      total_count: 2,
      items_count: 3,
      items: [
        { type: "backlinks_anchor", anchor: "example pricing", rank: 300, backlinks: 40, referring_domains: 9, first_seen: "2022-01-01 00:00:00 +00:00" },
        { type: "backlinks_anchor", backlinks: 4, referring_domains: 2 },
        { type: "backlinks_anchor", anchor: "", rank: 10, backlinks: 6, referring_domains: 1 },
      ],
    }];

    expect(trimAnchors(result)).toEqual([
      { anchor: "example pricing", backlinks: 40, referringDomains: 9 },
      { anchor: "", backlinks: 6, referringDomains: 1 },
    ]);
  });

  it("returns an empty list for an empty result", () => {
    expect(trimAnchors([])).toEqual([]);
  });
});

describe("referringDomainGap", () => {
  const dom = (domain: string, rank: number): ReferringDomain => ({
    domain,
    rank,
    backlinks: 1,
    spamScore: 0,
    firstSeen: null,
  });

  it("returns competitor-only domains, ignoring case, excluding the own domain, sorted by rank desc", () => {
    const own = [dom("shared.io", 50), dom("ONLY-OWN.com", 900)];
    const competitor = [
      dom("Shared.IO", 500),
      dom("gap-low.net", 100),
      dom("example.com", 800),
      dom("gap-high.org", 700),
      dom("only-own.com", 600),
    ];

    expect(referringDomainGap(own, competitor, "Example.com")).toEqual([
      dom("gap-high.org", 700),
      dom("gap-low.net", 100),
    ]);
  });

  it("returns an empty list when the competitor adds nothing", () => {
    expect(referringDomainGap([dom("a.com", 1)], [dom("A.com", 9)])).toEqual([]);
  });
});

describe("task builders", () => {
  it("builds the summary call", () => {
    expect(summaryTask("example.com")).toEqual({
      endpoint: "/v3/backlinks/summary/live",
      task: { target: "example.com", include_subdomains: true, exclude_internal_backlinks: true, backlinks_status_type: "live" },
      estimateUsd: 0.025,
    });
  });

  it("builds the referring domains call", () => {
    expect(referringDomainsTask("example.com")).toEqual({
      endpoint: "/v3/backlinks/referring_domains/live",
      task: {
        target: "example.com",
        include_subdomains: true,
        exclude_internal_backlinks: true,
        backlinks_status_type: "live",
        limit: 1000,
        order_by: ["rank,desc"],
      },
      estimateUsd: 0.0625,
    });
  });

  it("builds the anchors call", () => {
    expect(anchorsTask("example.com")).toEqual({
      endpoint: "/v3/backlinks/anchors/live",
      task: {
        target: "example.com",
        include_subdomains: true,
        exclude_internal_backlinks: true,
        backlinks_status_type: "live",
        limit: 100,
        order_by: ["backlinks,desc"],
      },
      estimateUsd: 0.03,
    });
  });
});

describe("fetch wrappers", () => {
  const gateResult = { value: { ok: true }, cached: false };
  const opts = { now, signal: new AbortController().signal };

  beforeEach(() => {
    mocks.runDataForSeo.mockResolvedValue(gateResult);
  });

  it("fetchBacklinkSummary passes the summary call, TTL and opts to the gate", async () => {
    await expect(fetchBacklinkSummary("ws-1", "example.com", opts)).resolves.toBe(gateResult);

    const [req, passedOpts] = mocks.runDataForSeo.mock.calls[0];
    expect(req).toMatchObject({
      workspaceId: "ws-1",
      endpoint: "/v3/backlinks/summary/live",
      task: summaryTask("example.com").task,
      ttlSeconds: TTL,
      estimateUsd: 0.025,
    });
    expect(req.trim([{ target: "example.com", rank: 1 }])).toMatchObject({ target: "example.com", rank: 1 });
    expect(passedOpts).toBe(opts);
  });

  it("fetchReferringDomains passes the referring domains call to the gate", async () => {
    await expect(fetchReferringDomains("ws-1", "example.com")).resolves.toBe(gateResult);

    const [req, passedOpts] = mocks.runDataForSeo.mock.calls[0];
    expect(req).toMatchObject({
      workspaceId: "ws-1",
      endpoint: "/v3/backlinks/referring_domains/live",
      task: referringDomainsTask("example.com").task,
      ttlSeconds: TTL,
      estimateUsd: 0.0625,
    });
    expect(req.trim([{ items: [{ domain: "a.com", rank: 2 }] }])).toEqual([
      { domain: "a.com", rank: 2, backlinks: 0, spamScore: 0, firstSeen: null },
    ]);
    expect(passedOpts).toBeUndefined();
  });

  it("fetchAnchors passes the anchors call to the gate", async () => {
    await expect(fetchAnchors("ws-1", "example.com", opts)).resolves.toBe(gateResult);

    const [req, passedOpts] = mocks.runDataForSeo.mock.calls[0];
    expect(req).toMatchObject({
      workspaceId: "ws-1",
      endpoint: "/v3/backlinks/anchors/live",
      task: anchorsTask("example.com").task,
      ttlSeconds: TTL,
      estimateUsd: 0.03,
    });
    expect(req.trim([{ items: [{ anchor: "x", backlinks: 3, referring_domains: 2 }] }])).toEqual([
      { anchor: "x", backlinks: 3, referringDomains: 2 },
    ]);
    expect(passedOpts).toBe(opts);
  });
});

describe("peekBacklinkReport", () => {
  it("peeks all three endpoints with the builder params and returns the cached values", async () => {
    const summary = { target: "example.com", rank: 1 };
    const domains = [{ domain: "a.com", rank: 2, backlinks: 1, spamScore: 0, firstSeen: null }];
    mocks.peekDataForSeo.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/v3/backlinks/summary/live") return summary;
      if (endpoint === "/v3/backlinks/referring_domains/live") return domains;
      return null;
    });

    await expect(peekBacklinkReport("example.com")).resolves.toEqual({
      summary,
      referringDomains: domains,
      anchors: null,
    });

    expect(mocks.peekDataForSeo).toHaveBeenCalledTimes(3);
    expect(mocks.peekDataForSeo).toHaveBeenCalledWith(summaryTask("example.com").endpoint, summaryTask("example.com").task);
    expect(mocks.peekDataForSeo).toHaveBeenCalledWith(referringDomainsTask("example.com").endpoint, referringDomainsTask("example.com").task);
    expect(mocks.peekDataForSeo).toHaveBeenCalledWith(anchorsTask("example.com").endpoint, anchorsTask("example.com").task);
  });

  it("returns nulls when nothing is cached", async () => {
    mocks.peekDataForSeo.mockResolvedValue(null);
    await expect(peekBacklinkReport("example.com")).resolves.toEqual({
      summary: null,
      referringDomains: null,
      anchors: null,
    });
  });
});
