import type { Metadata } from "next";
import Link from "next/link";

import { PageHead, Shell } from "@/components/shell";
import { billingServer } from "@/lib/billing/polar";
import { BILLING_PLANS } from "@/lib/billing/products";
import { DEFAULT_LIMITS } from "@/lib/plans/types";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Start free. Upgrade to Pro for more sources, more keywords and scans every three hours.",
  alternates: { canonical: "/pricing" },
};

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "not-configured": "Checkout is not set up yet. Please try again soon.",
  "unknown-product": "That plan is not available.",
  "checkout-failed": "Checkout could not be started. Please try again.",
  "no-subscription": "You have no subscription to manage yet. Pick a plan below.",
  "portal-failed": "The billing portal could not be opened. Please try again.",
};

function features(plan: "free" | "pro"): string[] {
  const l = DEFAULT_LIMITS[plan];
  return [
    `${l.sources} sources`,
    `${l.keywords} keywords`,
    `${l.projects} ${l.projects === 1 ? "project" : "projects"}`,
    `Up to ${l.scored_leads_per_day} scored conversations a day`,
    l.scan_interval_hours === 24 ? "Daily scans" : `Scans every ${l.scan_interval_hours} hours`,
    ...(l.reply_briefs ? ["Reply briefs"] : []),
    ...(l.deep_searches_per_month ? [`${l.deep_searches_per_month} deep searches a month`] : []),
    ...(l.seo_questions_per_month ? [`${l.seo_questions_per_month} SEO agent questions a month`] : []),
    ...(l.seo_credits_per_month ? [`${l.seo_credits_per_month} SEO data credits a month`] : []),
  ];
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? ERRORS[error] : undefined;
  const server = billingServer();

  return (
    <Shell wide section="pricing">
      <PageHead title="Pricing" lede="Start free. Upgrade when you want more sources, more keywords and fresher scans." />
      {message && <p role="alert" className="mb-8 rounded border border-contour bg-sheet p-4 text-sm">{message}</p>}
      <div className="grid gap-6 md:grid-cols-3">
        <section aria-labelledby="plan-free" className="flex flex-col rounded-lg border border-contour p-6">
          <h2 id="plan-free" className="text-xl font-bold">Free</h2>
          <p className="mt-2 text-3xl font-bold">$0</p>
          <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ridge">{features("free").map(f => <li key={f}>{f}</li>)}</ul>
          <Link href="/auth/sign-up" className="btn mt-6 text-center">Create a free account</Link>
        </section>
        {BILLING_PLANS.map(plan => (
          <section key={plan.key} aria-labelledby={`plan-${plan.key}`} className="flex flex-col rounded-lg border border-contour p-6">
            <h2 id={`plan-${plan.key}`} className="text-xl font-bold">{plan.name}</h2>
            <p className="mt-2 text-3xl font-bold">{plan.priceLabel}<span className="text-base font-normal text-ridge">/{plan.interval}</span></p>
            <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ridge">{features(plan.grants).map(f => <li key={f}>{f}</li>)}</ul>
            <form action="/api/billing/checkout" method="post" className="mt-6">
              <input type="hidden" name="productId" value={plan.productIds[server]} />
              <button className="btn w-full">Upgrade to Pro</button>
            </form>
          </section>
        ))}
      </div>
      <p className="mt-8 text-sm text-ridge">
        Payments are handled by Polar, our merchant of record. You can manage or cancel your subscription at any time from Plan &amp; usage.
      </p>
    </Shell>
  );
}
