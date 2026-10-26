import { describe, expect, it } from "vitest";
import { pricingErrorMessage } from "@/lib/billing/pricing-errors";

describe("pricingErrorMessage", () => {
  it("returns the copy for a known error code", () => {
    expect(pricingErrorMessage("checkout-failed")).toMatch(/Checkout could not be started/);
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])(
    "ignores the Object.prototype key %s instead of crashing the page",
    (key) => {
      expect(pricingErrorMessage(key)).toBeUndefined();
    },
  );

  it("ignores missing and unknown codes", () => {
    expect(pricingErrorMessage(undefined)).toBeUndefined();
    expect(pricingErrorMessage("")).toBeUndefined();
    expect(pricingErrorMessage("nope")).toBeUndefined();
  });
});
