import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ paid: false, userId: "user-1" as string | null, status: "open" }));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: async () => ({ data: { user: { id: state.userId } } }) } }));
vi.mock("@/lib/billing/entitlement", () => ({ userHasPaidPlan: async () => state.paid }));
vi.mock("@/lib/billing/polar", () => ({ getPolar: () => ({ checkouts: { get: async () => ({ external_customer_id: "user-1", status: state.status }) } }) }));
vi.mock("@/lib/billing/next-step", () => ({ nextStepHref: async () => "/workspace?workspaceId=ws-1" }));

import SuccessPage from "@/app/success/page";

const checkoutId = "00000000-0000-0000-0000-000000000001";
const render = async (params: { checkout_id?: string; retry?: string } = {}) =>
  renderToStaticMarkup(await SuccessPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  state.paid = false;
  state.userId = "user-1";
  state.status = "open";
});

describe("success page automatic rechecks", () => {
  it("preserves the checkout and increments the retry count", async () => {
    const html = await render({ checkout_id: checkoutId });
    expect(html).toContain(`5;url=/success?checkout_id=${checkoutId}&amp;retry=1`);
    expect(await render({ checkout_id: checkoutId, retry: "11" })).toContain("retry=12");
  });

  it.each(["12", "13", "-1", "invalid", "Infinity", "1.5", "999999999999999999999999999"])("stops at the cap or invalid count %s", async (retry) => {
    const html = await render({ checkout_id: checkoutId, retry });
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain("Check Plan &amp; usage");
    expect(html).toContain('href="/settings/plan"');
    expect(html).not.toContain("This page updates by itself");
  });

  it.each([undefined, "invalid"])("does not recheck without a valid checkout: %s", async (checkout_id) => {
    expect(await render({ checkout_id })).not.toContain('http-equiv="refresh"');
  });

  it("does not recheck for signed-out users or failed payments", async () => {
    state.userId = null;
    const signedOut = await render({ checkout_id: checkoutId });
    expect(signedOut).not.toContain('http-equiv="refresh"');
    expect(signedOut).toContain("Sign in to check your payment");
    expect(signedOut).not.toContain("This page updates by itself");
    state.userId = "user-1";
    for (const status of ["failed", "expired"]) {
      state.status = status;
      const html = await render({ checkout_id: checkoutId });
      expect(html).not.toContain('http-equiv="refresh"');
      expect(html).toContain("The payment did not go through");
    }
  });

  it("still forwards paid users when the recheck cap is reached", async () => {
    state.paid = true;
    expect(await render({ checkout_id: checkoutId, retry: "12" })).toContain("4;url=/workspace?workspaceId=ws-1");
  });
});
