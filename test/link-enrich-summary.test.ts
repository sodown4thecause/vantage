import { beforeEach, expect, it, vi } from "vitest";

import { summariseLinkedPage } from "@/lib/enrich/summarise";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), paid: vi.fn(), cost: vi.fn() }));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("@/lib/providers/paid-call", () => ({ runPaidCall: mocks.paid }));
vi.mock("@/lib/seo-agent/models", () => ({ costOfUsage: mocks.cost, gatewayProvider: () => (model: string) => model }));
vi.mock("@/lib/seo-agent/model-config", () => ({ seoModels: () => ({ classifier: "classifier" }) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.generateText.mockResolvedValue({ text: " Summary text ", usage: { inputTokens: 100, outputTokens: 10 } });
});

it.each([0.0003, undefined])("reports actual cost %s alongside the paid call value", async (costUsd) => {
  mocks.cost.mockReturnValue(costUsd);
  mocks.paid.mockImplementation(async (_meta, work) => {
    const result = await work();
    expect(result).toEqual({ value: { summary: "Summary text", costUsd }, costUsd });
    return result.value;
  });
  expect(await summariseLinkedPage({ url: "https://example.com", title: null, text: "Page", workspaceId: "ws" })).toEqual({ summary: "Summary text", costUsd });
  expect(mocks.paid).toHaveBeenCalledTimes(1);
});
