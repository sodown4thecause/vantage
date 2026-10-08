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

import { deleteVectors, queryVectors, upsertVectors, type VectorItem } from "@/lib/embeddings/store";
import { createFakeVectorize } from "./helpers/fake-vectorize";

function bind(fake: ReturnType<typeof createFakeVectorize> | null) {
  ctx.throws = false;
  ctx.env = fake ? { VECTORIZE: fake.binding } : {};
}

const WS_A = "ws-a";
const WS_B = "ws-b";

beforeEach(() => {
  ctx.throws = false;
  ctx.env = undefined;
});

describe("namespace isolation", () => {
  it("does not return a vector upserted for workspace A to a query from workspace B", async () => {
    const fake = createFakeVectorize();
    bind(fake);
    await upsertVectors(WS_A, [{ id: "a1", values: [1, 0, 0], kind: "doc" }]);

    expect(await queryVectors(WS_B, [1, 0, 0], { kind: "doc", topK: 5 })).toEqual([]);
    const own = await queryVectors(WS_A, [1, 0, 0], { kind: "doc", topK: 5 });
    expect(own?.map((m) => m.id)).toEqual(["a1"]);
    expect(fake.calls.filter((c) => c.op === "query").every((c) => c.op === "query" && c.options.namespace)).toBe(true);
  });

  it("returns an empty array for a workspace with no vectors", async () => {
    bind(createFakeVectorize());
    expect(await queryVectors(WS_B, [1, 0, 0], { kind: "doc", topK: 5 })).toEqual([]);
  });

  it("returns null, not an empty array, when the binding is absent", async () => {
    bind(null);
    expect(await queryVectors(WS_A, [1, 0, 0], { kind: "doc", topK: 5 })).toBeNull();
  });
});

describe("query filtering", () => {
  it("excludes vectors of other kinds", async () => {
    bind(createFakeVectorize());
    await upsertVectors(WS_A, [
      { id: "doc-1", values: [1, 0, 0], kind: "doc" },
      { id: "profile-1", values: [1, 0, 0], kind: "profile" },
    ]);
    const hits = await queryVectors(WS_A, [1, 0, 0], { kind: "profile", topK: 5 });
    expect(hits?.map((m) => m.id)).toEqual(["profile-1"]);
  });

  it("drops matches below minScore", async () => {
    bind(createFakeVectorize());
    await upsertVectors(WS_A, [
      { id: "close", values: [1, 0, 0], kind: "doc" },
      { id: "mid", values: [0.6, 0.8, 0], kind: "doc" },
      { id: "far", values: [0, 1, 0], kind: "doc" },
    ]);
    const hits = await queryVectors(WS_A, [1, 0, 0], { kind: "doc", topK: 5, minScore: 0.5 });
    expect(hits?.map((m) => m.id)).toEqual(["close", "mid"]);
    expect(hits?.[1]?.score).toBeCloseTo(0.6);
  });

  it("clamps topK to 50 because metadata is returned", async () => {
    const fake = createFakeVectorize();
    bind(fake);
    await queryVectors(WS_A, [1, 0, 0], { kind: "doc", topK: 500 });
    const query = fake.calls.find((c) => c.op === "query");
    expect(query?.op === "query" && query.options.topK).toBe(50);
  });
});

describe("upsert", () => {
  it("chunks more than 1000 vectors into batches of 1000", async () => {
    const fake = createFakeVectorize();
    bind(fake);
    const items: VectorItem[] = Array.from({ length: 2500 }, (_, i) => ({
      id: `v${i}`,
      values: [1, 0, 0],
      kind: "material",
    }));
    expect(await upsertVectors(WS_A, items)).toBe(true);
    const sizes = fake.calls.flatMap((c) => (c.op === "upsert" ? [c.vectors.length] : []));
    expect(sizes).toEqual([1000, 1000, 500]);
  });

  it("writes the workspace as the namespace and kind into metadata", async () => {
    const fake = createFakeVectorize();
    bind(fake);
    await upsertVectors(WS_A, [{ id: "p1", values: [1, 0, 0], kind: "profile", platform: "hn", postedAt: 42 }]);
    const upsert = fake.calls.find((c) => c.op === "upsert");
    expect(upsert?.op === "upsert" && upsert.vectors[0]).toEqual({
      id: "p1",
      namespace: WS_A,
      metadata: { kind: "profile", platform: "hn", postedAt: 42 },
    });
  });
});

describe("delete", () => {
  it("removes the requested ids", async () => {
    const fake = createFakeVectorize();
    bind(fake);
    await upsertVectors(WS_A, [{ id: "a1", values: [1, 0, 0], kind: "doc" }]);
    expect(await deleteVectors(WS_A, ["a1"])).toBe(true);
    expect(await queryVectors(WS_A, [1, 0, 0], { kind: "doc", topK: 5 })).toEqual([]);
  });
});

describe("scope enforcement", () => {
  it("throws on an empty workspaceId before touching the binding", async () => {
    const fake = createFakeVectorize();
    bind(fake);
    await expect(upsertVectors("", [{ id: "x", values: [1, 0, 0], kind: "doc" }])).rejects.toThrow(/workspaceId/);
    await expect(queryVectors("   ", [1, 0, 0], { kind: "doc", topK: 5 })).rejects.toThrow(/workspaceId/);
    await expect(deleteVectors("", ["x"])).rejects.toThrow(/workspaceId/);
    expect(fake.calls).toEqual([]);
  });
});

describe("failure handling", () => {
  it("returns false or null when the binding throws, without rejecting", async () => {
    bind(createFakeVectorize({ throws: new Error("secret index endpoint 10.1.2.3") }));
    expect(await upsertVectors(WS_A, [{ id: "x", values: [1, 0, 0], kind: "doc" }])).toBe(false);
    expect(await queryVectors(WS_A, [1, 0, 0], { kind: "doc", topK: 5 })).toBeNull();
    expect(await deleteVectors(WS_A, ["x"])).toBe(false);
  });

  it("returns false or null when the binding is absent", async () => {
    bind(null);
    expect(await upsertVectors(WS_A, [{ id: "x", values: [1, 0, 0], kind: "doc" }])).toBe(false);
    expect(await queryVectors(WS_A, [1, 0, 0], { kind: "doc", topK: 5 })).toBeNull();
    expect(await deleteVectors(WS_A, ["x"])).toBe(false);
  });
});

describe("single entry point", () => {
  it("no file outside lib/embeddings/store.ts and lib/cf/env.ts touches the VECTORIZE binding", () => {
    const root = process.cwd();
    const skip = new Set(["node_modules", ".superpowers", ".next", ".open-next", ".git", ".claude", ".wrangler", "docs", "drizzle"]);
    const allowed = new Set(["lib/embeddings/store.ts", "lib/cf/env.ts"]);
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
          if (/\bVECTORIZE\b|\bgetVectorize\b/.test(readFileSync(full, "utf8"))) hits.push(rel);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  }, 30_000);
});
