import { describe, expect, it } from "vitest";

import {
  classifyCollectorCoverage,
  documentsAreFixtureOnly,
  readLastRunReceipt,
  withLastRunReceipt,
} from "../lib/collectors/coverage";
import { collectorsByType } from "../lib/collectors/registry";
import { sourceHealthEnum } from "../lib/db/schema";

describe("collector coverage classification", () => {
  it("marks fixture-only documents as degraded, not healthy", () => {
    const result = classifyCollectorCoverage({
      documents: [
        { metadata: { provider: "fixture", mocked: true } },
        { metadata: { provider: "fixture" } },
      ],
      inserted: 2,
      skipped: 0,
    });
    expect(result.coverage).toBe("degraded");
    expect(result.health).toBe("degraded");
    expect(result.provider).toBe("fixture");
    expect(result.reason).toMatch(/fixture/i);
  });

  it("marks live scavio documents as healthy", () => {
    const result = classifyCollectorCoverage({
      documents: [{ metadata: { provider: "scavio" } }],
      inserted: 1,
      skipped: 0,
    });
    expect(result.coverage).toBe("healthy");
    expect(result.provider).toBe("scavio");
  });

  it("classifies access / budget / blocked / failed errors", () => {
    expect(
      classifyCollectorCoverage({
        documents: [],
        inserted: 0,
        skipped: 0,
        error: "Missing SCAVIO_API_KEY",
      }).coverage,
    ).toBe("access_pending");

    expect(
      classifyCollectorCoverage({
        documents: [],
        inserted: 0,
        skipped: 0,
        error: "429 rate limit exceeded",
      }).coverage,
    ).toBe("budget_limited");

    expect(
      classifyCollectorCoverage({
        documents: [],
        inserted: 0,
        skipped: 0,
        error: "blocked by cloudflare",
      }).coverage,
    ).toBe("blocked");

    expect(
      classifyCollectorCoverage({
        documents: [],
        inserted: 0,
        skipped: 0,
        error: "boom",
      }).coverage,
    ).toBe("failed");
  });

  it("detects fixture-only batches", () => {
    expect(
      documentsAreFixtureOnly([
        { metadata: { provider: "fixture" } },
        { metadata: { mocked: true } },
      ]),
    ).toBe(true);
    expect(
      documentsAreFixtureOnly([{ metadata: { provider: "scavio" } }]),
    ).toBe(false);
  });

  it("round-trips last-run receipts on source config", () => {
    const receipt = {
      ...classifyCollectorCoverage({
        documents: [{ metadata: { provider: "tinyfish_search" } }],
        inserted: 3,
        skipped: 1,
      }),
      ranAt: "2026-09-21T10:00:00.000Z",
    };
    const config = withLastRunReceipt({ query: "saas" }, receipt);
    expect(config.query).toBe("saas");
    expect(readLastRunReceipt(config)).toEqual(receipt);
  });
});

describe("collector registry contract", () => {
  it("registers every shipped discovery source type", () => {
    for (const type of [
      "hn",
      "rss",
      "substack",
      "producthunt",
      "youtube",
      "reddit",
      "x",
    ] as const) {
      expect(collectorsByType[type]?.name).toBeTruthy();
    }
  });

  it("exposes expanded source health / coverage enum values", () => {
    expect(sourceHealthEnum.enumValues).toEqual(
      expect.arrayContaining([
        "healthy",
        "degraded",
        "access_pending",
        "budget_limited",
        "blocked",
        "failed",
      ]),
    );
  });
});
