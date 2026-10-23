import type { Metadata } from "next";
import Link from "next/link";

import { PageHead, Shell } from "@/components/shell";
import { auth } from "@/lib/auth/server";
import { userHasPaidPlan } from "@/lib/billing/entitlement";
import { getPolar } from "@/lib/billing/polar";
import { nextStepHref } from "@/lib/billing/next-step";

export const metadata: Metadata = { title: "Thanks for upgrading", robots: { index: false } };
export const dynamic = "force-dynamic";

const CHECKOUT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Seconds before the success page moves on by itself. */
const FORWARD_SECONDS = 4;
const RECHECK_SECONDS = 5;
const MAX_RECHECKS = 12;

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

export default async function SuccessPage({ searchParams }: { searchParams: Promise<{ checkout_id?: string; retry?: string }> }) {
  const { checkout_id: checkoutId, retry } = await searchParams;
  const rechecks = retry === undefined ? 0 : /^\d+$/.test(retry) ? Number(retry) : MAX_RECHECKS;
  const { data } = await auth.getSession();
  const userId = data?.user?.id ? String(data.user.id) : null;
  const [paid, status] = userId
    ? await Promise.all([userHasPaidPlan(userId), checkoutStatus(checkoutId, userId)])
    : [false, null];

  const failed = status === "failed" || status === "expired";
  const next = paid ? await nextStepHref() : null;
  const recheck = !paid && userId && !failed && checkoutId && CHECKOUT_ID_RE.test(checkoutId) && rechecks < MAX_RECHECKS;
  const self = `/success?checkout_id=${encodeURIComponent(checkoutId ?? "")}&retry=${rechecks + 1}`;

  return (
    <Shell>
      {next && <meta httpEquiv="refresh" content={`${FORWARD_SECONDS};url=${next}`} />}
      {recheck && <meta httpEquiv="refresh" content={`${RECHECK_SECONDS};url=${self}`} />}
      {paid ? (
        <PageHead
          title="Payment received. You're on Pro"
          lede="More sources, more keywords and scans every three hours are ready. Taking you to your workspace…"
        />
      ) : (
        <PageHead
          title={userId ? "Thanks, we're confirming your payment" : "Sign in to check your payment"}
          lede={failed
            ? "The payment did not go through. You have not been charged; you can try again from Pricing."
            : !userId
              ? "Sign in through Plan & usage to check your payment and current plan."
              : recheck
              ? "Pro switches on as soon as Polar confirms the payment, usually within a few seconds. This page updates by itself."
              : "We haven't confirmed your payment yet. Check Plan & usage for your current plan; you can refresh this page later."}
        />
      )}
      <p className="flex flex-wrap gap-4">
        {next ? (
          <Link href={next} className="btn">Open your workspace</Link>
        ) : (
          <Link href="/settings/plan" className="btn">Go to Plan &amp; usage</Link>
        )}
        {next && <Link href="/settings/plan" className="link self-center">Plan &amp; usage</Link>}
        {!paid && <Link href="/pricing" className="link self-center">Back to pricing</Link>}
      </p>
    </Shell>
  );
}
