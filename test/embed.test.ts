import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ai: null as unknown,
  requestContext: null as unknown,
  recorded: [] as Array<Record<string, unknown>>,
  costError: null as Error | null,
}));

vi.mock("@/lib/cf/env", () => ({
  getAi: async () => state.ai,
  getCloudflareRequestContext: async () => state.requestContext,
}));
vi.mock("@/lib/costs/ledger", () => ({
  recordCost: async (input: Record<string, unknown>) => {
    if (state.costError) throw state.costError;
    state.recorded.push(input);
    return true;
  },
}));
vi.mock("@/lib/costs/prices", () => ({
  getUnitCost: async () => 0.0118,
}));

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedTexts } from "@/lib/embeddings/embed";
import { createFakeAi, fakeVector } from "./helpers/fake-ai";

const ctx = { workspaceId: "ws-1", sourceKey: "reddit" };

beforeEach(() => {
  state.ai = null;
  state.requestContext = null;
  state.recorded = [];
  state.costError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("embedTexts", () => {
  it("returns index-aligned vectors and passes the gateway option", async () => {
    const fake = createFakeAi();
    state.ai = fake.binding;
    const out = await embedTexts(["alpha", "beta", "gamma"], ctx);
    expect(out).toHaveLength(3);
    expect(out?.[0]).toEqual(fakeVector("alpha"));
    expect(out?.[1]).toEqual(fakeVector("beta"));
    expect(out?.[2]).toEqual(fakeVector("gamma"));
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      model: EMBEDDING_MODEL,
      text: ["alpha", "beta", "gamma"],
      options: { gateway: { id: "vantage" } },
    });
  });

  it("records an allowlisted span around Workers AI embeddings", async () => {
    const fake = createFakeAi();
    const attributes: Record<string, unknown> = {};
    const spanNames: string[] = [];
    state.ai = fake.binding;
    state.requestContext = {
      tracing: {
        enterSpan: async (name: string, callback: (span: {
          setAttribute: (key: string, value: unknown) => void;
          setAttributes: (values: Record<string, unknown>) => void;
        }) => unknown) => {
          spanNames.push(name);
          return callback({
            setAttribute: (key, value) => { attributes[key] = value; },
            setAttributes: (values) => Object.assign(attributes, values),
          });
        },
      },
    };
    await embedTexts(["private embedding text"], ctx);
    expect(spanNames).toEqual(["ai.embedding"]);
    expect(attributes).toMatchObject({
      workspaceId: "ws-1", source: "reddit", provider: "workers_ai", status: "ok",
    });
    expect(Object.keys(attributes).sort()).toEqual(["durationMs", "provider", "source", "status", "workspaceId"]);
    expect(JSON.stringify(attributes)).not.toContain("private embedding text");
  });

  it("does not send blank text and returns an empty array at that index", async () => {
    const fake = createFakeAi();
    state.ai = fake.binding;
    const out = await embedTexts(["first text", "   ", "third text"], ctx);
    expect(fake.calls[0].text).toEqual(["first text", "third text"]);
    expect(out?.[1]).toEqual([]);
    expect(out?.[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(out?.[2]).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("splits large inputs into batches of at most 64", async () => {
    const fake = createFakeAi();
    state.ai = fake.binding;
    const texts = Array.from({ length: 150 }, (_, i) => `text number ${i}`);
    const out = await embedTexts(texts, ctx);
    expect(out).toHaveLength(150);
    expect(fake.calls.map((c) => c.text.length)).toEqual([64, 64, 22]);
    expect(fake.calls.every((c) => c.text.length <= 64)).toBe(true);
  });

  it("truncates text longer than 6000 characters before sending", async () => {
    const fake = createFakeAi();
    state.ai = fake.binding;
    await embedTexts(["x".repeat(7000)], ctx);
    expect(fake.calls[0].text[0]).toHaveLength(6000);
  });

  it("returns null and does not throw when the binding throws", async () => {
    state.ai = createFakeAi({ throws: new Error("AI down") }).binding;
    await expect(embedTexts(["hello"], ctx)).resolves.toBeNull();
  });

  it("retries without the gateway option when the gateway call fails", async () => {
    const run = vi.fn(async (_model: string, _input: unknown, options?: unknown) => {
      if (options) throw new Error("AiGatewayError: 503");
      return { data: [fakeVector("hello")] };
    });
    state.ai = { run };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await embedTexts(["hello"], { sourceKey: "test" });
    expect(out).toEqual([fakeVector("hello")]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]).toHaveLength(2);
  });
  it("does not retry without the gateway when the scan stopped during the call", async () => {
    const controller = new AbortController();
    const run = vi.fn(async () => {
      controller.abort();
      throw new Error("Gateway unavailable");
    });
    state.ai = { run };
    await expect(embedTexts(["hello"], { ...ctx, signal: controller.signal })).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("logs only the error class when cost metering fails", async () => {
    state.ai = createFakeAi().binding;
    state.costError = new TypeError("postgres://user:secret@db.internal/vantage");
    await expect(embedTexts(["hello"], ctx)).resolves.toEqual([expect.any(Array)]);
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).not.toContain("secret");
    expect(logs).toContain('"error":"TypeError"');
  });

  it("returns null when a vector has the wrong dimension", async () => {
    state.ai = createFakeAi({ dim: 768 }).binding;
    await expect(embedTexts(["hello"], ctx)).resolves.toBeNull();
    expect(state.recorded).toHaveLength(1);
    expect(state.recorded[0]).toMatchObject({ ok: false });
  });

  it("returns null when no binding is present", async () => {
    state.ai = null;
    await expect(embedTexts(["hello"], ctx)).resolves.toBeNull();
    expect(state.recorded).toHaveLength(0);
  });

  it("records one embed_m_tokens cost row per batch, sized from ceil(chars / 4)", async () => {
    state.ai = createFakeAi().binding;
    await embedTexts(["abcd", "abcdefghi"], ctx);
    expect(state.recorded).toHaveLength(1);
    // ceil(4/4) + ceil(9/4) = 1 + 3 = 4 tokens
    expect(state.recorded[0]).toMatchObject({
      sourceKey: "reddit",
      workspaceId: "ws-1",
      provider: "workers_ai",
      action: "embed_m_tokens",
      units: 4 / 1_000_000,
      unitCostUsd: 0.0118,
      ok: true,
    });
  });
});
