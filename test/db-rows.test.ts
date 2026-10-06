import { describe, expect, it } from "vitest";

import { numericField, rowsOf } from "@/lib/db/rows";

describe("rowsOf", () => {
  it("accepts a plain array or an object with rows, and nothing else", () => {
    expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(rowsOf({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    for (const bad of [null, undefined, 5, "x", {}, { rows: "nope" }]) expect(rowsOf(bad)).toEqual([]);
  });
});

describe("numericField", () => {
  it("reads numbers and numeric strings", () => {
    expect(numericField({ used: 3 }, "used")).toBe(3);
    expect(numericField({ used: "4.5" }, "used")).toBe(4.5);
  });

  it("returns null for missing, blank, non-numeric and non-object input", () => {
    for (const row of [{}, { used: "" }, { used: "abc" }, { used: null }, { used: NaN }, null, undefined, 7, "x"]) {
      expect(numericField(row, "used")).toBeNull();
    }
  });
});
