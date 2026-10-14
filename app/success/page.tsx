import type { Metadata } from "next";
import Link from "next/link";

import { PageHead, Shell } from "@/components/shell";
import { auth } from "@/lib/auth/server";
import { userHasPaidPlan } from "@/lib/billing/entitlement";
import { getPolar } from "@/lib/billing/polar";

export const metadata: Metadata = { title: "Thanks for upgrading", robots: { index: false } };
export const dynamic = "force-dynamic";

const CHECKOUT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Polar's checkout status, only for a checkout that belongs to the signed-in user. */
async function checkoutStatus(checkoutId: string | undefined, userId: string): Promise<string | null> {
  if (!checkoutId || !CHECKOUT_ID_RE.test(checkoutId)) return null;
  try {
    const checkout = await getPolar().checkouts.get(checkoutId);
    return checkout.external_customer_id === userId ? checkout.status : null;
  } catch {
    return null;
  }
}

export default async function SuccessPage({ searchParams }: { searchParams: Promise<{ checkout_id?: string }> }) {
  const { checkout_id: checkoutId } = await searchParams;
  const { data } = await auth.getSession();
  const userId = data?.user?.id ? String(data.user.id) : null;
  const [paid, status] = userId
    ? await Promise.all([userHasPaidPlan(userId), checkoutStatus(checkoutId, userId)])
    : [false, null];

  return (
    <Shell>
      {paid ? (
        <PageHead title="You're on Pro" lede="Your upgrade is active. More sources, more keywords and scans every three hours are ready to use." />
      ) : (
        <PageHead
          title="Thanks, we're confirming your payment"
          lede={status === "failed" || status === "expired"
            ? "The payment did not go through. You have not been charged; you can try again from Pricing."
            : "Pro switches on as soon as Polar confirms the payment, usually within a few seconds. Refresh this page to check."}
        />
      )}
      <p className="flex flex-wrap gap-4">
        <Link href="/settings/plan" className="btn">Go to Plan &amp; usage</Link>
        {!paid && <Link href="/pricing" className="link self-center">Back to pricing</Link>}
      </p>
    </Shell>
  );
}
