import { redirect } from "next/navigation";
import Link from "next/link";

import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { listOpportunityQueue } from "@/lib/opportunities/run";
import { ScanButton } from "@/app/source-controls";
import { Glyph } from "@/components/glyph";
import { PageHead, Shell } from "@/components/shell";

export default async function OpportunityQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const params = await searchParams;
  const workspaceId = params.workspaceId?.trim() || (await getCurrentWorkspace())?.id;

  if (!workspaceId) redirect("/");

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return (
      <Shell workspaceId={workspaceId} active="queue">
        <p className="text-stop" role="alert">
          Unable to load this opportunity queue.
        </p>
      </Shell>
    );
  }

  const cards = await listOpportunityQueue({ workspaceId, limit: 5 });

  return (
    <Shell workspaceId={workspaceId} active="queue" wide>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <PageHead
          title="Today's opportunities"
          lede="Up to five conversations worth joining, each backed by posts you can read."
        />
        <div className="mb-8">
          <ScanButton workspaceId={workspaceId} />
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="max-w-xl space-y-2 border-t border-contour pt-6" data-testid="queue-empty">
          <p className="text-xl font-semibold tracking-tight">Nothing strong right now.</p>
          <p className="text-ridge">
            Scan your sources again, or{" "}
            <Link href={`/onboarding?workspaceId=${encodeURIComponent(workspaceId)}`} className="link">
              refine your monitoring profile
            </Link>{" "}
            so Vantage knows what to look for.
          </p>
        </div>
      ) : (
        <ol className="border-t border-contour" data-testid="queue-list">
          {cards.map((c) => (
            <li
              key={c.id}
              className="grid gap-x-8 gap-y-4 border-b border-contour py-8 sm:grid-cols-[7rem_1fr]"
            >
              <div className="flex flex-col items-start gap-1">
                <Glyph features={c.features} size={112} />
                <p className="text-sm text-ridge">
                  Score <span className="font-bold text-ink">{c.score.toFixed(2)}</span>
                </p>
              </div>
              <div className="min-w-0 space-y-3">
                <div className="space-y-1.5">
                  <Link
                    href={`/opportunities/${c.id}?workspaceId=${encodeURIComponent(workspaceId)}`}
                    className="link block text-2xl font-semibold leading-tight tracking-tight"
                  >
                    {c.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ridge">
                    <span className="rounded-full px-2.5 py-0.5 font-medium capitalize text-ink shadow-[inset_0_0_0_1px_var(--contour)]">
                      {c.status}
                    </span>
                    <span>{c.evidenceCount} {c.evidenceCount === 1 ? "post" : "posts"} as evidence</span>
                    <span>Confidence {c.confidence.toFixed(2)}</span>
                  </div>
                </div>
                <p className="max-w-[64ch] text-[1.0625rem] leading-snug">{c.whyItMatters}</p>
                <dl className="grid max-w-[64ch] gap-x-6 gap-y-2 text-[0.9375rem] sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold">Why now</dt>
                    <dd className="text-ridge">{c.whyNow}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Next step</dt>
                    <dd className="text-ridge">{c.recommendedAction}</dd>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Shell>
  );
}
