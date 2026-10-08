import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  throwContext: false,
  env: {} as Record<string, unknown>,
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (state.throwContext) throw new Error("no cloudflare context");
    return { env: state.env };
  },
}));

import { getAi, getSemanticMode, getVectorize } from "@/lib/cf/env";

const originalMode = process.env.VANTAGE_SEMANTIC_MODE;

beforeEach(() => {
  state.throwContext = false;
  state.env = {};
});

afterEach(() => {
  if (originalMode === undefined) delete process.env.VANTAGE_SEMANTIC_MODE;
  else process.env.VANTAGE_SEMANTIC_MODE = originalMode;
  vi.restoreAllMocks();
});

describe("getSemanticMode", () => {
  it("defaults to off when unset", () => {
    delete process.env.VANTAGE_SEMANTIC_MODE;
    expect(getSemanticMode()).toBe("off");
  });

  it("treats unrecognised values as off", () => {
    process.env.VANTAGE_SEMANTIC_MODE = "bogus";
    expect(getSemanticMode()).toBe("off");
  });

  it("returns shadow and on verbatim", () => {
    process.env.VANTAGE_SEMANTIC_MODE = "shadow";
    expect(getSemanticMode()).toBe("shadow");
    process.env.VANTAGE_SEMANTIC_MODE = "on";
    expect(getSemanticMode()).toBe("on");
  });
});

describe("getAi", () => {
  it("returns null when there is no Cloudflare context", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.throwContext = true;
    expect(await getAi()).toBeNull();
  });

  it("returns null when env.AI lacks run()", async () => {
    state.env = { AI: { notRun: true } };
    expect(await getAi()).toBeNull();
  });

  it("returns the binding when it exposes run()", async () => {
    const ai = { run: async () => ({}) };
    state.env = { AI: ai };
    expect(await getAi()).toBe(ai);
  });
});

describe("getVectorize", () => {
  it("returns null when there is no Cloudflare context", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.throwContext = true;
    expect(await getVectorize()).toBeNull();
  });

  it("returns null when env.VECTORIZE lacks query()", async () => {
    state.env = { VECTORIZE: { upsert: async () => ({}) } };
    expect(await getVectorize()).toBeNull();
  });

  it("returns the binding when it exposes query()", async () => {
    const index = { query: async () => ({ matches: [] }) };
    state.env = { VECTORIZE: index };
    expect(await getVectorize()).toBe(index);
  });
});
