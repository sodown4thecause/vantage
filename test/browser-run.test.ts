import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const ctx = vi.hoisted(() => ({ env: undefined as unknown, throws: false }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (ctx.throws) throw new Error("OpenNext context is not available");
    return { env: ctx.env };
  },
}));

import {
  BrowserRunError,
  browserJson,
  browserLinks,
  browserMarkdown,
  browserScreenshot,
  DEFAULT_BROWSER_HOUR_USD,
  isDeniedHost,
  type BrowserRunDeps,
} from "@/lib/browser/run";
import { createFakeBrowser, type FakeBrowserOptions } from "./helpers/fake-browser";

function setup(fake: FakeBrowserOptions = {}, over: Partial<BrowserRunDeps> = {}) {
  const { binding, calls } = createFakeBrowser(fake);
  const recorded: Array<Record<string, unknown>> = [];
  const deps: Partial<BrowserRunDeps> = {
    getBinding: () => binding,
    getSwitch: async () => ({ enabled: true, state: "on", reason: "" }),
    getUnitCost: async () => DEFAULT_BROWSER_HOUR_USD,
    record: async (input) => {
      recorded.push(input as unknown as Record<string, unknown>);
      return true;
    },
    ...over,
  };
  return { deps, calls, recorded };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof BrowserRunError ? e.code : "other";
  }
  return "none";
}

describe("SSRF guard", () => {
  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest",
    "http://10.0.0.1/",
    "http://intranet.internal/",
    "ftp://example.com/",
    "https://user:pw@example.com/",
    "http://example.com:8080/",
    "not a url",
  ])("rejects %s before touching the binding", async (url) => {
    const { deps, calls, recorded } = setup({ result: "x" });
    expect(await code(browserMarkdown(url, { deps }))).toBe("invalid_url");
    expect(await code(browserLinks(url, { deps }))).toBe("invalid_url");
    expect(await code(browserJson(url, {}, { deps }))).toBe("invalid_url");
    expect(await code(browserScreenshot({ url }, { deps }))).toBe("invalid_url");
    expect(calls).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });
});

describe("platform denylist", () => {
  it.each([
    "https://reddit.com/r/x",
    "https://www.reddit.com/r/x",
    "https://old.reddit.com/",
    "https://linkedin.com/in/a",
    "https://www.linkedin.com/",
    "https://facebook.com/a",
    "https://m.facebook.com/a",
    "https://instagram.com/a",
    "https://x.com/a",
    "https://twitter.com/a",
    "https://mobile.twitter.com/a",
    "https://REDDIT.COM./r/x",
    "https://redd.it/abc",
    "https://t.co/abc",
    "https://lnkd.in/abc",
    "https://fb.com/a",
    "https://fb.me/a",
    "https://instagr.am/p/a",
    "https://fb.watch/a",
  ])("refuses %s", async (url) => {
    const { deps, calls } = setup({ result: "x" });
    expect(await code(browserMarkdown(url, { deps }))).toBe("denied_host");
    expect(await code(browserScreenshot({ url }, { deps }))).toBe("denied_host");
    expect(calls).toHaveLength(0);
  });

  it("does not match lookalike hosts", () => {
    expect(isDeniedHost("notreddit.com")).toBe(false);
    expect(isDeniedHost("box.com")).toBe(false);
    expect(isDeniedHost("example.com")).toBe(false);
    expect(isDeniedHost("fit.co")).toBe(false);
    expect(isDeniedHost(new URL("https://a.t.co/x").hostname)).toBe(true);
  });
});

describe("happy paths", () => {
  it("markdown returns text and records a cost row from the measured ms", async () => {
    const { deps, calls, recorded } = setup({ result: "# Hi", ms: 3_600_000 / 2 });
    const out = await browserMarkdown("https://example.com/", { deps, workspaceId: "w1" });
    expect(out).toEqual({ markdown: "# Hi", ms: 1_800_000 });
    expect(calls).toEqual([{ action: "markdown", params: { url: "https://example.com/" } }]);
    expect(recorded).toEqual([
      expect.objectContaining({
        sourceKey: "browser_run",
        provider: "cloudflare_browser_run",
        action: "markdown",
        units: 1800,
        unitCostUsd: 0.000025,
        workspaceId: "w1",
        ok: true,
      }),
    ]);
  });

  it("uses the hourly price returned by getUnitCost, as a per-second price", async () => {
    const { deps, recorded } = setup({ result: "x", ms: 1000 }, { getUnitCost: async () => 0.36 });
    await browserMarkdown("https://example.com/", { deps });
    expect(recorded[0].unitCostUsd).toBeCloseTo(0.0001, 10);
    expect(recorded[0].units).toBe(1);
  });

  it("sends the normalized URL to the binding", async () => {
    const { deps, calls } = setup({ result: "x", ms: 1 });
    await browserMarkdown("https://EXAMPLE.com", { deps });
    expect(calls[0].params.url).toBe("https://example.com/");
  });

  it("falls back to wall time when X-Browser-Ms-Used is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps, recorded } = setup({ result: "x" });
    await browserMarkdown("https://example.com/", { deps });
    expect(recorded[0].ok).toBe(true);
    expect(typeof recorded[0].units).toBe("number");
    expect(console.error).toHaveBeenCalled();
  });

  it("uses an explicit binding or env without OpenNext context", async () => {
    ctx.throws = true;
    const a = createFakeBrowser({ result: "A", ms: 1 });
    const rec = vi.fn(async () => true);
    const sw = async () => ({ enabled: true, state: "on" as const, reason: "" });
    const common = { deps: { record: rec, getSwitch: sw, getUnitCost: async () => 0.09 } };
    expect((await browserMarkdown("https://example.com/", { ...common, binding: a.binding })).markdown).toBe("A");
    expect((await browserMarkdown("https://example.com/", { ...common, env: { BROWSER: a.binding } })).markdown).toBe("A");
    ctx.throws = false;
  });

  it("default binding: reads env.BROWSER from the OpenNext context", async () => {
    const f = createFakeBrowser({ result: "ctx", ms: 1 });
    ctx.env = { BROWSER: f.binding };
    const deps = {
      record: async () => true,
      getSwitch: async () => ({ enabled: true, state: "on" as const, reason: "" }),
      getUnitCost: async () => 0.09,
    };
    expect((await browserMarkdown("https://example.com/", { deps })).markdown).toBe("ctx");
  });

  it("default binding: no context or no BROWSER becomes binding_missing", async () => {
    const deps = {
      record: async () => true,
      getSwitch: async () => ({ enabled: true, state: "on" as const, reason: "" }),
      getUnitCost: async () => 0.09,
    };
    ctx.throws = true;
    expect(await code(browserMarkdown("https://example.com/", { deps }))).toBe("binding_missing");
    ctx.throws = false;
    ctx.env = {};
    expect(await code(browserMarkdown("https://example.com/", { deps }))).toBe("binding_missing");
  });

  it("json sends a schema and validates the result", async () => {
    const { deps, calls } = setup({ result: { name: "A" }, ms: 10 });
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const out = await browserJson<{ name: string }>("https://example.com/", schema, {
      deps,
      prompt: "get name",
    });
    expect(out.data).toEqual({ name: "A" });
    expect(calls[0].params).toMatchObject({
      response_format: { type: "json_schema", json_schema: schema },
      prompt: "get name",
    });
    const failing = setup({ result: { nope: 1 } });
    expect(
      await code(
        browserJson("https://example.com/", schema, {
          deps: failing.deps,
          validate: () => {
            throw new Error("bad");
          },
        }),
      ),
    ).toBe("bad_response");
  });

  it("links returns strings and screenshot returns bytes (url or html)", async () => {
    const l = setup({ result: ["https://a.example/", "https://b.example/"], ms: 5 });
    expect(await browserLinks("https://example.com/", { deps: l.deps })).toHaveLength(2);
    const png = new Uint8Array([137, 80, 78, 71]);
    const s = setup({ raw: png, ms: 7 });
    const out = await browserScreenshot({ html: "<p>hi</p>" }, { deps: s.deps });
    expect(Array.from(out.png)).toEqual([137, 80, 78, 71]);
    expect(s.calls[0].params).toEqual({ html: "<p>hi</p>" });
    expect(await code(browserScreenshot({}, { deps: s.deps }))).toBe("invalid_url");
  });
});

describe("limits and failures", () => {
  it("times out and records the elapsed wall time as billable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const { deps, recorded } = setup({ hang: true });
      const p = code(browserMarkdown("https://example.com/", { deps, timeoutMs: 50 }));
      await vi.advanceTimersByTimeAsync(60);
      expect(await p).toBe("timeout");
      expect(recorded[0]).toMatchObject({ ok: false, chargedOnFailure: true });
      expect(recorded[0].units as number).toBeGreaterThanOrEqual(0.05);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps output size", async () => {
    const { deps } = setup({ result: "x".repeat(500), ms: 1 });
    expect(await code(browserMarkdown("https://example.com/", { deps, maxBytes: 100 }))).toBe("too_large");
    const big = setup({ raw: new Uint8Array(200) });
    expect(await code(browserScreenshot({ url: "https://example.com/" }, { deps: big.deps, maxBytes: 100 }))).toBe(
      "too_large",
    );
    const png = setup({ raw: new Uint8Array(2_000_000), ms: 1 });
    expect((await browserScreenshot({ url: "https://example.com/" }, { deps: png.deps })).png.length).toBe(2_000_000);
  });

  it("blocks the call when the browser_run switch is off", async () => {
    const { deps, calls, recorded } = setup(
      { result: "x" },
      { getSwitch: async () => ({ enabled: false, state: "paused", reason: "budget" }) },
    );
    const err = await browserMarkdown("https://example.com/", { deps }).catch((e) => e);
    expect(err).toBeInstanceOf(BrowserRunError);
    expect(err.code).toBe("source_paused");
    expect(calls).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it("surfaces binding errors without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps, recorded } = setup({ throws: new Error("secret token abc at 10.1.2.3") });
    const err = await browserMarkdown("https://example.com/", { deps }).catch((e) => e);
    expect(err).toBeInstanceOf(BrowserRunError);
    expect(err.code).toBe("upstream_error");
    expect(err.message).not.toMatch(/secret|abc|10\.1/);
    expect(recorded[0]).toMatchObject({ ok: false });
    const http = setup({ status: 500, result: "internal stack trace" });
    const err2 = await browserMarkdown("https://example.com/", { deps: http.deps }).catch((e) => e);
    expect(err2.message).not.toMatch(/stack/);
  });

  it("reports a missing binding clearly", async () => {
    const { deps } = setup({}, { getBinding: () => undefined });
    expect(await code(browserMarkdown("https://example.com/", { deps }))).toBe("binding_missing");
  });
});

describe("single entry point", () => {
  it("no file outside lib/browser/run.ts touches the BROWSER binding", () => {
    const root = process.cwd();
    const skip = new Set(["node_modules", ".next", ".open-next", ".git", ".claude", ".wrangler", "docs", "drizzle"]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(name) && !name.endsWith(".d.ts")) {
          const rel = relative(root, full);
          if (rel === "lib/browser/run.ts" || rel.startsWith("test/")) continue;
          if (/quickAction|\bBROWSER\b/.test(readFileSync(full, "utf8"))) hits.push(rel);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
