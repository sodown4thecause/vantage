import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

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
        units: 0.5,
        unitCostUsd: 0.09,
        workspaceId: "w1",
        ok: true,
      }),
    ]);
  });

  it("uses the price returned by getUnitCost", async () => {
    const { deps, recorded } = setup({ result: "x", ms: 1000 }, { getUnitCost: async () => 0.12 });
    await browserMarkdown("https://example.com/", { deps });
    expect(recorded[0].unitCostUsd).toBe(0.12);
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
  it("times out and records a zero-cost failed row", async () => {
    vi.useFakeTimers();
    try {
      const { deps, recorded } = setup({ hang: true });
      const p = code(browserMarkdown("https://example.com/", { deps, timeoutMs: 50 }));
      await vi.advanceTimersByTimeAsync(60);
      expect(await p).toBe("timeout");
      expect(recorded[0]).toMatchObject({ ok: false, units: 0 });
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
    const skip = new Set(["node_modules", ".next", ".open-next", ".git", ".claude", "docs", "drizzle"]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
          const rel = relative(root, full);
          if (rel === "lib/browser/run.ts" || rel.startsWith("test/")) continue;
          if (/quickAction\s*\(|env\.BROWSER\b|\.BROWSER\b/.test(readFileSync(full, "utf8"))) hits.push(rel);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
