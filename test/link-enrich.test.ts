import { describe, expect, it } from "vitest";

import {
  candidateLinkUrls,
  isPdfUrl,
  isSkippedHost,
  normaliseLinkedUrl,
} from "@/lib/enrich/url";
import {
  LINK_POST_MAX_CHARS,
  decideFromCache,
  enrichDailyMax,
  firstEnrichableLink,
} from "@/lib/enrich/run";

describe("normaliseLinkedUrl", () => {
  it("strips utm_* parameters and fragments", () => {
    const link = normaliseLinkedUrl("https://example.com/page?utm_source=x&id=7#section");
    expect(link?.url).toBe("https://example.com/page?id=7");
  });

  it("sorts remaining parameters so one page hashes to one key", () => {
    const a = normaliseLinkedUrl("https://example.com/?b=2&a=1");
    const b = normaliseLinkedUrl("https://example.com/?a=1&b=2");
    expect(a?.url).toBe(b?.url);
    expect(a?.urlHash).toBe(b?.urlHash);
  });

  it("hashes the normalised URL with sha256", () => {
    const link = normaliseLinkedUrl("https://example.com/page");
    expect(link?.urlHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("classifies YouTube hosts and leaves other pages as page kind", () => {
    expect(normaliseLinkedUrl("https://www.youtube.com/watch?v=abc")?.kind).toBe("youtube");
    expect(normaliseLinkedUrl("https://youtu.be/abc")?.kind).toBe("youtube");
    expect(normaliseLinkedUrl("https://example.com/page")?.kind).toBe("page");
  });

  it("rejects non-HTTP schemes and garbage", () => {
    expect(normaliseLinkedUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseLinkedUrl("not a url")).toBeNull();
  });
});

describe("skip rules", () => {
  it("skips reddit and x hosts, including subdomains", () => {
    expect(isSkippedHost("https://www.reddit.com/r/SaaS/comments/1")).toBe(true);
    expect(isSkippedHost("https://old.reddit.com/r/SaaS")).toBe(true);
    expect(isSkippedHost("https://x.com/someone/status/1")).toBe(true);
    expect(isSkippedHost("https://example.com/reddit.com")).toBe(false);
  });

  it("detects PDFs by path", () => {
    expect(isPdfUrl("https://example.com/report.pdf")).toBe(true);
    expect(isPdfUrl("https://example.com/report")).toBe(false);
  });
});

describe("candidateLinkUrls", () => {
  it.each(["https://example.com/article", "https://youtu.be/abc"])("selects a Reddit outbound link: %s", outboundUrl => {
    const doc = {
      urlCanonical: "https://www.reddit.com/r/SaaS/comments/1",
      title: "News",
      contentMd: "# News",
      metadata: { outboundUrl },
    };
    expect(candidateLinkUrls(doc)).toEqual([outboundUrl, doc.urlCanonical]);
    expect(firstEnrichableLink(doc)?.url).toBe(outboundUrl);
  });

  it("ignores malformed outbound metadata and deduplicates normalized URLs", () => {
    const doc = { urlCanonical: "https://example.com/a", title: null, contentMd: "https://example.com/a" };
    expect(candidateLinkUrls({ ...doc, metadata: { outboundUrl: 42 } })).toEqual([doc.urlCanonical]);
    expect(candidateLinkUrls({ ...doc, metadata: { outboundUrl: "javascript:alert" } })).toEqual([doc.urlCanonical]);
    expect(candidateLinkUrls({ ...doc, metadata: { outboundUrl: "https://example.com/a?utm_source=reddit" } })).toEqual([doc.urlCanonical]);
  });

  it("prefers URLs in the body and de-duplicates", () => {
    const links = candidateLinkUrls({
      urlCanonical: "https://example.com/canonical",
      title: null,
      contentMd: "Read https://example.com/a?utm_source=x then https://example.com/a",
    });
    expect(links[0]).toBe("https://example.com/a");
    expect(links.at(-1)).toBe("https://example.com/canonical");
    expect(new Set(links).size).toBe(links.length);
  });
});

describe("decideFromCache", () => {
  const now = new Date("2026-10-25T00:00:00Z");
  const base = { title: null, summary: "s", attempts: 1, lastAttemptAt: now };

  it("uses a fresh ok row without fetching", () => {
    const decision = decideFromCache({ ...base, status: "ok", fetchedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) }, now);
    expect(decision).toEqual({ action: "use", row: { title: null, summary: "s" } });
  });

  it("refetches an ok row older than 30 days", () => {
    const decision = decideFromCache({ ...base, status: "ok", fetchedAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000) }, now);
    expect(decision).toEqual({ action: "fetch", priorAttempts: 0 });
  });

  it("never retries a skipped row", () => {
    const decision = decideFromCache({ ...base, status: "skipped", summary: null, fetchedAt: null }, now);
    expect(decision).toEqual({ action: "skip" });
  });

  it("waits 24 hours before retrying a failed row", () => {
    const fresh = decideFromCache({ ...base, status: "failed", summary: null, fetchedAt: null, lastAttemptAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) }, now);
    expect(fresh).toEqual({ action: "skip" });
    const stale = decideFromCache({ ...base, status: "failed", summary: null, fetchedAt: null, lastAttemptAt: new Date(now.getTime() - 25 * 60 * 60 * 1000) }, now);
    expect(stale).toEqual({ action: "fetch", priorAttempts: 1 });
  });

  it("gives up after two failed attempts", () => {
    const decision = decideFromCache({ ...base, status: "failed", summary: null, fetchedAt: null, attempts: 2, lastAttemptAt: new Date(now.getTime() - 48 * 60 * 60 * 1000) }, now);
    expect(decision).toEqual({ action: "skip" });
  });

  it("fetches a URL with no cache row", () => {
    expect(decideFromCache(null, now)).toEqual({ action: "fetch", priorAttempts: 0 });
  });
});

describe("budget", () => {
  it("defaults to 20 and honours 0 as off", () => {
    expect(enrichDailyMax({})).toBe(20);
    expect(enrichDailyMax({ ENRICH_DAILY_MAX: "" })).toBe(20);
    expect(enrichDailyMax({ ENRICH_DAILY_MAX: "   " })).toBe(20);
    expect(enrichDailyMax({ ENRICH_DAILY_MAX: "0" })).toBe(0);
    expect(enrichDailyMax({ ENRICH_DAILY_MAX: "5" })).toBe(5);
    expect(enrichDailyMax({ ENRICH_DAILY_MAX: "not-a-number" })).toBe(20);
  });
});

describe("link post selection", () => {
  it("requires a short body with an outbound URL and skips reddit-only links", () => {
    const short = firstEnrichableLink({
      urlCanonical: "https://example.com/article",
      title: "Big news",
      contentMd: "",
    });
    expect(short?.url).toBe("https://example.com/article");

    const redditOnly = firstEnrichableLink({
      urlCanonical: "https://www.reddit.com/r/SaaS/comments/1",
      title: "Discussion",
      contentMd: "",
    });
    expect(redditOnly).toBeNull();
  });

  it("does not enrich posts of 100 characters or more", () => {
    const under = firstEnrichableLink({ urlCanonical: "https://example.com/a", title: null, contentMd: "x".repeat(LINK_POST_MAX_CHARS - 1) });
    expect(under?.url).toBe("https://example.com/a");
    const at = firstEnrichableLink({ urlCanonical: "https://example.com/a", title: null, contentMd: "x".repeat(LINK_POST_MAX_CHARS) });
    expect(at).toBeNull();
  });

  it("measures the body without counting the title the collectors already copy into it", () => {
    const title = "A".repeat(60);
    const link = "https://example.com/story";
    // HN: an empty story_text falls back to the title, so contentMd === title.
    expect(firstEnrichableLink({ urlCanonical: link, title, contentMd: title })?.url).toBe(link);
    // Reddit: header lines and "# title" precede the selftext.
    const reddit = (body: string) => `r/SaaS\nu/someone\n\n# ${title}\n\n${body}`;
    expect(firstEnrichableLink({ urlCanonical: link, title, contentMd: reddit("") })?.url).toBe(link);
    expect(firstEnrichableLink({ urlCanonical: link, title, contentMd: reddit("x".repeat(LINK_POST_MAX_CHARS - 1)) })?.url).toBe(link);
    expect(firstEnrichableLink({ urlCanonical: link, title, contentMd: reddit("x".repeat(LINK_POST_MAX_CHARS)) })).toBeNull();
    // A long selftext stays a discussion post whatever its title says.
    expect(firstEnrichableLink({ urlCanonical: link, title, contentMd: "x".repeat(300) })).toBeNull();
  });
});
