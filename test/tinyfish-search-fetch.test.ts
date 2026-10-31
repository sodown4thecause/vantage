import { TinyFish } from "@tiny-fish/sdk";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/costs/ledger", () => ({ recordCost: async () => true }));
vi.mock("@/lib/costs/prices", () => ({ getUnitCost: async () => 0 }));

import { scanIssuesFromError } from "@/lib/scan/health";
import { tinyFishFetchMarkdown, tinyFishSearch } from "@/lib/tinyfish/search-fetch";

afterEach(() => { vi.unstubAllGlobals(); });

const client = new TinyFish({ apiKey: "synthetic-test-key", maxRetries: 0 });
const operations = [
  { name: "search", stage: "discovery", run: () => tinyFishSearch("synthetic", { client }), empty: { query: "synthetic", results: [], total_results: 0, page: 1 } },
  { name: "fetch", stage: "hydration", run: () => tinyFishFetchMarkdown(["https://www.reddit.com/r/synthetic/comments/abc/test/"], { client }), empty: { results: [], errors: [] } },
] as const;

it.each(operations)("keeps explicit empty $name results as an empty success", async ({ run, empty }) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(empty)));
  expect(await run()).toEqual([]);
});

it.each(operations)("reports malformed $name envelopes as safe invalid_payload health", async ({ stage, run }) => {
  for (const payload of [{}, { results: null }, { results: {} }]) {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
    const error = await run().catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(scanIssuesFromError(error, stage, "tinyfish_search_fetch")).toEqual([
      { stage, kind: "invalid_payload", provider: "tinyfish_search_fetch", retryable: false },
    ]);
  }
});
