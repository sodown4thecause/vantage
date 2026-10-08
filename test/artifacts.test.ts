import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({ env: undefined as unknown, throws: false }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (ctx.throws) throw new Error("OpenNext context is not available");
    return { env: ctx.env };
  },
}));

import { artifactKey, putArtifact } from "@/lib/r2/artifacts";
import { createFakeR2 } from "./helpers/fake-r2";

const WS = "0b8f3c2e-7d1a-4e5b-9c6d-1a2b3c4d5e6f";
const ID = "5f1e2d3c-4b5a-4968-8777-665544332211";

beforeEach(() => {
  ctx.throws = false;
  ctx.env = undefined;
});

describe("artifactKey", () => {
  it("joins workspace, kind and id", () => {
    expect(artifactKey(WS, "screenshot", ID)).toBe(`${WS}/screenshot/${ID}`);
    expect(artifactKey("ws-a", "snapshot", "shot_1")).toBe("ws-a/snapshot/shot_1");
  });

  it.each([
    ["", "screenshot", ID],
    ["../etc", "screenshot", ID],
    ["ws/a", "screenshot", ID],
    ["ws\\a", "screenshot", ID],
    ["-leading", "screenshot", ID],
    [WS, "screenshot", "../../x"],
    [WS, "screenshot", "a.png"],
    [WS, "screenshot", "x%2e%2e"],
    [WS, "screenshot", "a".repeat(65)],
    [WS, "video", ID],
  ])("throws RangeError for workspaceId %j, kind %j, id %j", (ws, kind, id) => {
    expect(() => artifactKey(ws, kind as "screenshot", id)).toThrow(RangeError);
  });
});

describe("putArtifact", () => {
  const key = artifactKey(WS, "screenshot", ID);

  it("returns null when ARTIFACTS is absent", async () => {
    ctx.env = {};
    expect(await putArtifact(key, new ArrayBuffer(3), "image/png")).toBeNull();
  });

  it("returns null when there is no OpenNext context", async () => {
    ctx.throws = true;
    expect(await putArtifact(key, new ArrayBuffer(3), "image/png")).toBeNull();
  });

  it("stores the bytes with their content type and returns the key", async () => {
    const { bucket, puts } = createFakeR2();
    ctx.env = { ARTIFACTS: bucket };
    const body = new Uint8Array([137, 80, 78, 71]).buffer;
    expect(await putArtifact(key, body, "image/png")).toBe(key);
    expect(puts).toEqual([{ key, body, contentType: "image/png" }]);
  });

  it("accepts a string body", async () => {
    const { bucket, puts } = createFakeR2();
    ctx.env = { ARTIFACTS: bucket };
    expect(await putArtifact(artifactKey(WS, "snapshot", ID), "<html></html>", "text/html")).toBe(
      `${WS}/snapshot/${ID}`,
    );
    expect(puts[0]).toMatchObject({ body: "<html></html>", contentType: "text/html" });
  });

  it("returns null without rejecting when the put fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { bucket } = createFakeR2({ throws: new Error("secret bucket token abc") });
    ctx.env = { ARTIFACTS: bucket };
    expect(await putArtifact(key, new ArrayBuffer(3), "image/png")).toBeNull();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toMatch(/secret|abc/);
    errorSpy.mockRestore();
  });

  it("refuses a malformed key without touching the bucket", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { bucket, puts } = createFakeR2();
    ctx.env = { ARTIFACTS: bucket };
    expect(await putArtifact("../escape/screenshot/x", new ArrayBuffer(3), "image/png")).toBeNull();
    expect(await putArtifact(`${WS}/video/${ID}`, new ArrayBuffer(3), "image/png")).toBeNull();
    expect(puts).toEqual([]);
    errorSpy.mockRestore();
  });
});

describe("wrangler bindings", () => {
  it("declares ARTIFACTS at top level and per environment with staging resource names", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8"));
    const bucket = (name: string) => [{ binding: "ARTIFACTS", bucket_name: name }];
    expect(config.r2_buckets).toEqual(bucket("vantage-artifacts"));
    expect(config.env.production.r2_buckets).toEqual(bucket("vantage-artifacts"));
    expect(config.env.staging.r2_buckets).toEqual(bucket("vantage-artifacts-staging"));
  });
});

describe("single entry point", () => {
  it("no file outside lib/r2/artifacts.ts and lib/cf/env.ts mentions ARTIFACTS", () => {
    const root = process.cwd();
    const skip = new Set(["node_modules", ".next", ".open-next", ".git", ".claude", ".wrangler", "docs", "drizzle"]);
    const allowed = new Set(["lib/r2/artifacts.ts", "lib/cf/env.ts"]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(name) && !name.endsWith(".d.ts")) {
          const rel = relative(root, full);
          const posixRel = rel.replaceAll("\\", "/");
          if (allowed.has(posixRel) || posixRel.startsWith("test/")) continue;
          if (/\bARTIFACTS\b/.test(readFileSync(full, "utf8"))) hits.push(rel);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
    // Positive control: the allowed module really is the one that names the binding.
    expect(readFileSync(join(root, "lib/r2/artifacts.ts"), "utf8")).toMatch(/\bARTIFACTS\b/);
  });
});
