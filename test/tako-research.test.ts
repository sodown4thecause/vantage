import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordCost: vi.fn(), runPaidCall: vi.fn() }));
vi.mock("@/lib/costs/ledger", () => ({ recordCost: mocks.recordCost }));
vi.mock("@/lib/providers/paid-call", () => ({
  runPaidCall: mocks.runPaidCall,
  isPaidCallDenied: (error: unknown) => error instanceof Error && error.name === "PaidCallDeniedError",
}));

import { isTakoFilterRequest, normalizeTakoSearchOutput, TAKO_FAST_SEARCH_USD, TakoSearchMeter, takoSearchUsd, takoWebResultCount } from "@/lib/research/tako";

beforeEach(() => {
  vi.stubEnv("TAKO_SEARCH_USD", "0");
  mocks.recordCost.mockReset().mockResolvedValue(true);
  mocks.runPaidCall.mockReset().mockImplementation(async (_meta: unknown, work: () => Promise<{ value?: unknown; error?: Error }>) => {
    const outcome = await work();
    if (outcome.error) throw outcome.error;
    return outcome.value;
  });
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

  it("keeps provider column indexes aligned and tolerates extra scalar cells", () => {
    const result = normalizeTakoSearchOutput({ cards: [{
      title: "Series",
      webpage_url: "https://example.com/series",
      content: { dataset: { columns: [null, { name: "Visitors", unit: "users" }], rows: [[42, 100, 7]] } },
    }] });
    expect(result.cards[0]?.value).toBe("Value 1: 42 · Visitors: 100 users · Value 3: 7");
  });

  it("recognises domain and date filter requests for Linkup fallback", () => {
    expect(isTakoFilterRequest({ sources: { web: { include_domains: ["example.com"] } } })).toBe(true);
    expect(isTakoFilterRequest({ sources: { web: { published_after: "2026-01-01" } } })).toBe(true);
    expect(isTakoFilterRequest({ query: "current research" })).toBe(false);
  });

  it("logs free calls at zero cost, but reserves nonzero pricing through runPaidCall before approval", async () => {
    const freeMeter = new TakoSearchMeter("workspace-1", "seo");
    await expect(freeMeter.approve("free-call")).resolves.toBe("approved");
    await freeMeter.complete("free-call", { web_results: [] });
    expect(mocks.recordCost).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1", sourceKey: "seo", provider: "gateway", action: "tako_search", units: 1, unitCostUsd: 0, ok: true,
    }));
    expect(mocks.runPaidCall).not.toHaveBeenCalled();

    vi.stubEnv("TAKO_SEARCH_USD", "0.007");
    const paidMeter = new TakoSearchMeter("workspace-1", "gtm");
    await expect(paidMeter.approve("paid-call")).resolves.toBe("approved");
    expect(mocks.runPaidCall).toHaveBeenCalledWith(expect.objectContaining({
      context: { workspaceId: "workspace-1", sourceKey: "gtm" },
      provider: "gateway", action: "tako_search", estimateUsd: 0.007,
    }), expect.any(Function));
    await paidMeter.complete("paid-call", { web_results: [] });
    expect(mocks.recordCost).toHaveBeenCalledOnce();
  });

  it("defaults to the fast list price and meters through runPaidCall when no price is configured", async () => {
    vi.stubEnv("TAKO_SEARCH_USD", "");
    expect(TAKO_FAST_SEARCH_USD).toBe(0.007);
    expect(takoSearchUsd()).toBe(0.007);
    vi.stubEnv("TAKO_SEARCH_USD", "not-a-number");
    expect(takoSearchUsd()).toBe(0.007);
    vi.stubEnv("TAKO_SEARCH_USD", "-1");
    expect(takoSearchUsd()).toBe(0.007);

    vi.stubEnv("TAKO_SEARCH_USD", "");
    const meter = new TakoSearchMeter("workspace-1", "seo");
    await expect(meter.approve("default-call")).resolves.toBe("approved");
    expect(mocks.runPaidCall).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gateway", action: "tako_search", estimateUsd: 0.007,
    }), expect.any(Function));
    await meter.complete("default-call", { web_results: [] });
    expect(mocks.recordCost).not.toHaveBeenCalled();
  });

  it("denies a priced Tako call when the provider budget cannot be reserved", async () => {
    vi.stubEnv("TAKO_SEARCH_USD", "0.007");
    mocks.runPaidCall.mockRejectedValue(new Error("budget exhausted"));
    const meter = new TakoSearchMeter("workspace-1", "seo");
    await expect(meter.approve("denied-call")).resolves.toMatchObject({ type: "denied" });
  });
});
