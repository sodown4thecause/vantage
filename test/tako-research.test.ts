import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordCost: vi.fn() }));
vi.mock("@/lib/costs/ledger", () => ({ recordCost: mocks.recordCost }));

import { isTakoFilterRequest, normalizeTakoSearchOutput, recordTakoSearchCost, takoWebResultCount } from "@/lib/research/tako";

beforeEach(() => {
  vi.stubEnv("TAKO_SEARCH_USD", "");
  mocks.recordCost.mockReset().mockResolvedValue(true);
});

afterEach(() => vi.unstubAllEnvs());

describe("Tako Search results", () => {
  it("normalises web citations and card values while dropping unsafe source URLs", () => {
    const result = normalizeTakoSearchOutput({
      web_results: [
        { title: "A source", url: "https://example.com/a", snippet: "Current evidence." },
        { title: "Unsafe", url: "javascript:alert(1)", snippet: "Not a link." },
      ],
      cards: [{ title: "Revenue", webpage_url: "https://example.com/revenue", content: { card_data: { amount: 42, unit: "USD" } } }],
    });
    expect(result).toEqual({
      web_results: [{ title: "A source", url: "https://example.com/a", snippet: "Current evidence." }],
      cards: [{ title: "Revenue", value: "amount: 42 · unit: USD", sourceUrl: "https://example.com/revenue" }],
    });
    expect(takoWebResultCount({ web_results: result.web_results, cards: result.cards })).toBe(1);
  });

  it("recognises domain and date filter requests for Linkup fallback", () => {
    expect(isTakoFilterRequest({ sources: { web: { include_domains: ["example.com"] } } })).toBe(true);
    expect(isTakoFilterRequest({ sources: { web: { published_after: "2026-01-01" } } })).toBe(true);
    expect(isTakoFilterRequest({ query: "current research" })).toBe(false);
  });

  it("records every Tako call at the configurable per-call USD price, defaulting to zero", async () => {
    await recordTakoSearchCost("workspace-1", "seo", { web_results: [] });
    expect(mocks.recordCost).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1", sourceKey: "seo", provider: "gateway", action: "tako_search", units: 1, unitCostUsd: 0, ok: true,
    }));
    vi.stubEnv("TAKO_SEARCH_USD", "0.007");
    await recordTakoSearchCost("workspace-1", "gtm", { error: "api_error" });
    expect(mocks.recordCost).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "gateway", action: "tako_search", unitCostUsd: 0.007, ok: false }));
  });
});
