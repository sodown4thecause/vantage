import { PAID_STATUSES } from "@/lib/billing/entitlement";
import { billingServer } from "@/lib/billing/polar";
import { BILLING_PLANS } from "@/lib/billing/products";
import type { PlanId } from "@/lib/plans/types";

export type SubscriptionState = {
  status: string;
  plan: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  endedAt: Date | null;
};

export function SubscriptionControls({
  plan,
  subscriptions,
  operatorGranted = false,
  now = new Date(),
}: {
  plan: PlanId;
  subscriptions: SubscriptionState[];
  operatorGranted?: boolean;
  now?: Date;
}) {
  const live = subscriptions.filter(
    (s) =>
      s.plan === "pro" &&
      (PAID_STATUSES as readonly string[]).includes(s.status) &&
      (!s.endedAt || s.endedAt > now),
  );
  const ends =
    !operatorGranted && live.length > 0 &&
    live.every(
      (s) =>
        s.cancelAtPeriodEnd && s.currentPeriodEnd && s.currentPeriodEnd > now,
    )
      ? new Date(Math.max(...live.map((s) => s.currentPeriodEnd!.getTime())))
      : null;
  const ended = !operatorGranted && plan === "free" && live.length === 0
    ? subscriptions
      .filter((s) => s.plan === "pro" && s.status === "canceled" && s.endedAt && s.endedAt <= now)
      .map((s) => s.endedAt!)
      .sort((a, b) => b.getTime() - a.getTime())[0]
    : null;
  const endDate = ends ?? ended;
  const server = billingServer();

  return (
    <section aria-label="Subscription" className="mt-6 space-y-4">
      {endDate && (
        <p data-testid="plan-ends">
          Your plan {ends ? "ends" : "ended"} on{" "}
          <time dateTime={endDate.toISOString()}>
            {endDate.toLocaleDateString("en-AU", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
          </time>
          .
        </p>
      )}
      {plan === "free" ? (
        <div className="flex flex-wrap gap-4">
          {BILLING_PLANS.map((option) => (
            <form
              key={option.key}
              action="/api/billing/checkout"
              method="post"
              className="rounded-lg border border-contour p-4"
            >
              <p className="mb-3 font-medium">
                {option.name} · {option.priceLabel}/{option.interval}
              </p>
              <input
                type="hidden"
                name="productId"
                value={option.productIds[server]}
              />
              <button className="btn">Upgrade to Pro</button>
            </form>
          ))}
        </div>
      ) : (
        <p className="text-sm">
          <a href="/api/billing/portal" className="link">
            Manage or cancel your subscription
          </a>
        </p>
      )}
    </section>
  );
}
