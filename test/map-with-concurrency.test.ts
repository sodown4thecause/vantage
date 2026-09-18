import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";

describe("mapWithConcurrency", () => {
  it("preserves result order while respecting the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return n * 2;
    });

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBe(2);
  });

  it("rejects invalid concurrency limits", async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow(
      "concurrency must be a positive integer",
    );
  });
});
