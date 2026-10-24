import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchLinkedPage, fetchYoutubeTranscript } from "@/lib/enrich/scrape";

beforeEach(() => vi.stubEnv("FIRECRAWL_API_KEY", "test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PDF size checks", () => {
  it("probes a PDF with query parameters before submitting it to Firecrawl", async () => {
    const headContentLength = vi.fn().mockResolvedValue(5_000_001);
    const fetchImpl = vi.fn();
    const url = "https://example.com/report.PDF?download=1";
    expect(await fetchLinkedPage(url, { headContentLength, fetchImpl })).toMatchObject({ outcome: "skipped", reason: "pdf over 5 MB" });
    expect(headContentLength).toHaveBeenCalledWith(url);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses a bounded public HEAD probe and respects its content length", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { headers: { "content-length": "6000000" } }));
    vi.stubGlobal("fetch", fetchImpl);
    expect(await fetchLinkedPage("https://example.com/report.pdf")).toMatchObject({ outcome: "skipped" });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("https://example.com/report.pdf", expect.objectContaining({
      method: "HEAD", redirect: "manual", signal: expect.any(AbortSignal),
    }));
  });

  it.each(["http://127.0.0.1/report.pdf", "http://service.internal/report.pdf", "https://example.com:8443/report.pdf"])("never sends a HEAD request to %s", async (url) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { markdown: "Page content" } })));
    vi.stubGlobal("fetch", fetchImpl);
    await fetchLinkedPage(url);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("https://api.firecrawl.dev/v2/scrape", expect.objectContaining({ method: "POST" }));
  });
});

it("treats missing provider credentials as transient, never a permanent skip", async () => {
  vi.stubEnv("FIRECRAWL_API_KEY", "");
  vi.stubEnv("SUPADATA_API_KEY", "");
  const fetchImpl = vi.fn();
  expect(await fetchLinkedPage("https://example.com/page", { fetchImpl })).toMatchObject({ outcome: "failed" });
  expect(await fetchYoutubeTranscript("https://youtu.be/abc", { fetchImpl })).toMatchObject({ outcome: "failed" });
  expect(fetchImpl).not.toHaveBeenCalled();
});
