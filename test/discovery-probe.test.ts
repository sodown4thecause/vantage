import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", async importOriginal => ({ ...await importOriginal<typeof import("undici")>(), fetch: mocks.fetch }));
import { createProbe, publicAddress, publicDns, publicTarget } from "@/scripts/discovery/probe";

describe("discovery public-network boundary", () => {
  beforeEach(() => { mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); mocks.fetch.mockReset(); });
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "2002:7f00:1::", "3fff::1"])("rejects non-public address %s", address => {
    expect(publicAddress(address)).toBe(false);
  });
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("accepts public address %s", address => {
    expect(publicAddress(address)).toBe(true);
  });
  it.each(["http://localhost/", "http://127.1/", "http://2130706433/", "file:///etc/passwd", "http://user:pass@example.com/", "http://example.com:8080/", "http://x.internal/", "https://[::1]/"])("rejects unsafe URL %s", async url => {
    await expect(publicTarget(url)).rejects.toThrow();
  });
  it("rejects public names with any private DNS answer", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(publicTarget("https://example.com/feed")).rejects.toThrow("DNS");
  });
  it("rejects a DNS rebind when the connection-time resolver runs again", async () => {
    await expect(publicTarget("https://example.com/feed")).resolves.toBeInstanceOf(URL);
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(publicDns("example.com")).rejects.toThrow("DNS");
  });
});

describe("discovery feed checks", () => {
  const dirs: string[] = [];
  beforeEach(() => { mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); mocks.fetch.mockReset(); });
  afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
  const directory = async () => { const dir = await mkdtemp(join(tmpdir(), "vantage-probe-")); dirs.push(dir); return dir; };
  it("blocks a redirect to a private target before a second fetch", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    const probe = createProbe(await directory(), true);
    try {
      expect((await probe.check("https://example.com/feed"))?.result).toBe("unknown");
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      expect(mocks.fetch.mock.calls[0][1].redirect).toBe("manual");
    } finally { await probe.close(); }
  });
  it("validates redirect DNS and reuses a cache without network calls", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://private.example.com/feed" } }));
    mocks.lookup.mockImplementation(async (host: string) => [{ address: host === "private.example.com" ? "10.0.0.1" : "93.184.216.34", family: 4 }]);
    const dir = await directory(); const probe = createProbe(dir, true);
    try { await probe.check("https://example.com/feed"); } finally { await probe.close(); }
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const offline = createProbe(dir, false);
    try { expect((await offline.check("https://example.com/feed"))?.result).toBe("unknown"); } finally { await offline.close(); }
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([['<rss version="2.0"><channel/></rss>', "yes"], ['<html><body>Sign in</body></html>', "unknown"], ['{"message":"not a feed"}', "unknown"]])("recognises feeds without treating HTML or arbitrary JSON as API access", async (body, expected) => {
    mocks.fetch.mockResolvedValue(new Response(body));
    const probe = createProbe(await directory(), true);
    try { expect((await probe.check("https://example.com/feed"))?.result).toBe(expected); } finally { await probe.close(); }
  });
  it("requires the Discourse topic list schema", async () => {
    mocks.fetch.mockResolvedValue(new Response('{"topic_list":{"topics":[]}}'));
    const probe = createProbe(await directory(), true);
    try { expect((await probe.check("https://example.com/latest.json"))?.result).toBe("yes"); } finally { await probe.close(); }
  });
  it("enforces one request per second across redirect hops", async () => {
    const starts: number[] = [];
    mocks.fetch.mockImplementation(async () => {
      starts.push(Date.now());
      return starts.length === 1 ? new Response(null, { status: 302, headers: { location: "/rss" } }) : new Response("<feed></feed>");
    });
    const probe = createProbe(await directory(), true);
    try {
      expect((await probe.check("https://example.com/feed"))?.result).toBe("yes");
      expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(990);
    } finally { await probe.close(); }
  });
  it("rejects oversized bodies without recording page text", async () => {
    mocks.fetch.mockResolvedValue(new Response("<rss>" + "x".repeat(128_000) + "</rss>"));
    const probe = createProbe(await directory(), true);
    try { expect((await probe.check("https://example.com/feed"))?.result).toBe("unknown"); } finally { await probe.close(); }
  });
  it("leaves missing offline evidence unknown and makes no request", async () => {
    const probe = createProbe(await directory(), false);
    try { expect(await probe.check("https://example.com/feed")).toBeNull(); } finally { await probe.close(); }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
