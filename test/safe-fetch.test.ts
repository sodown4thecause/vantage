import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MAX_RESPONSE_BYTES,
  UnsafeUrlError,
  assertPublicHttpUrl,
  guardedFetch,
  readTextWithinLimit,
} from "@/lib/collectors/safeFetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertPublicHttpUrl", () => {
  it("accepts plain public http(s) URLs", () => {
    expect(assertPublicHttpUrl("https://example.com/feed.xml").host).toBe(
      "example.com",
    );
    expect(assertPublicHttpUrl("http://example.com:8080/feed.xml").protocol).toBe(
      "http:",
    );
  });

  it("rejects non-web schemes", () => {
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl("ftp://example.com/x")).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl("data:text/xml,<rss/>")).toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects embedded credentials without echoing them", () => {
    let message = "";
    try {
      assertPublicHttpUrl("https://user:supersecret@example.com/private.xml");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/credentials/);
    expect(message).not.toContain("supersecret");
  });

  it("rejects loopback, private, link-local and metadata hosts", () => {
    for (const url of [
      "http://localhost/feed.xml",
      "http://sub.localhost/feed.xml",
      "http://127.0.0.1/feed.xml",
      "http://10.1.2.3/feed.xml",
      "http://172.16.0.9/feed.xml",
      "http://192.168.1.1/feed.xml",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/feed.xml",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://service.internal/feed.xml",
      "http://box.local/feed.xml",
      "http://[::1]/feed.xml",
      "http://[fe80::1]/feed.xml",
      "http://[::ffff:127.0.0.1]/feed.xml",
    ]) {
      expect(() => assertPublicHttpUrl(url), url).toThrow(UnsafeUrlError);
    }
  });
});

describe("guardedFetch", () => {
  it("never sends credentials and validates before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      guardedFetch("http://127.0.0.1/feed.xml"),
    ).rejects.toThrow(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects redirects that land on internal addresses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        }),
      ),
    );

    await expect(
      guardedFetch("https://example.com/feed.xml"),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it("follows public redirects up to the hop limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://example.com/feed-v2.xml" },
        }),
      )
      .mockResolvedValueOnce(new Response("<rss/>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await guardedFetch("https://example.com/feed.xml");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects responses whose declared size exceeds the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("small", {
          status: 200,
          headers: { "content-length": String(DEFAULT_MAX_RESPONSE_BYTES + 1) },
        }),
      ),
    );

    await expect(
      guardedFetch("https://example.com/feed.xml"),
    ).rejects.toThrow(/over the .*-byte limit/);
  });
});

describe("readTextWithinLimit", () => {
  it("returns bodies under the limit", async () => {
    const res = new Response("hello");
    await expect(readTextWithinLimit(res)).resolves.toBe("hello");
  });

  it("rejects bodies over the limit", async () => {
    const res = new Response("x".repeat(64));
    await expect(readTextWithinLimit(res, 8)).rejects.toThrow(
      /over the 8-byte limit/,
    );
  });
});
