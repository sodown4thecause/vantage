const PRICING_ERRORS: Record<string, string> = {
  "not-configured": "Checkout is not set up yet. Please try again soon.",
  "unknown-product": "That plan is not available.",
  "checkout-failed": "Checkout could not be started. Please try again.",
  "no-subscription": "You have no subscription to manage yet. Pick a plan below.",
  "portal-failed": "The billing portal could not be opened. Please try again.",
};

// Own keys only: "?error=constructor" (or __proto__, toString) must not
// resolve to an Object.prototype member and crash /pricing with a 500.
export function pricingErrorMessage(error: string | undefined): string | undefined {
  if (!error || !Object.hasOwn(PRICING_ERRORS, error)) return undefined;
  return PRICING_ERRORS[error];
}
