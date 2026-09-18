import { describe, expect, it } from "vitest";

import { parseValidDate } from "@/lib/collectors/date";

describe("parseValidDate", () => {
  it("returns a valid date for a valid timestamp", () => {
    expect(parseValidDate("2026-09-18T09:30:00.000Z")?.toISOString()).toBe(
      "2026-09-18T09:30:00.000Z",
    );
  });

  it("returns null for missing or invalid timestamps", () => {
    expect(parseValidDate(undefined)).toBeNull();
    expect(parseValidDate("not-a-date")).toBeNull();
  });
});
