import { describe, expect, it } from "vitest";

import { normalizePipelineOptions } from "@/lib/pipeline/options";

describe("normalizePipelineOptions", () => {
  it("uses safe defaults", () => {
    expect(normalizePipelineOptions({})).toEqual({ limit: 100, threshold: 2 });
  });

  it("clamps finite numeric values to safe ranges", () => {
    expect(normalizePipelineOptions({ limit: 50_000, threshold: 9 })).toEqual({
      limit: 1000,
      threshold: 4,
    });
    expect(normalizePipelineOptions({ limit: -5, threshold: -1 })).toEqual({
      limit: 1,
      threshold: 0,
    });
  });

  it("rejects non-numeric and non-finite values", () => {
    expect(() => normalizePipelineOptions({ limit: "100" })).toThrow(
      "limit must be a finite number",
    );
    expect(() => normalizePipelineOptions({ threshold: Number.NaN })).toThrow(
      "threshold must be a finite number",
    );
  });
});
