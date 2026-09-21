import Link from "next/link";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { getOpportunityDetail } from "@/lib/opportunities/run";

import { DraftPanel } from "./draft-panel";
import { FeedbackPanel } from "./feedback-panel";

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const workspaceId = sp.workspaceId?.trim();

  if (!workspaceId) {
    return (
      <Shell>
        <p className="text-sm text-zinc-600">workspaceId is required.</p>
      </Shell>
    );
  }

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return (
      <Shell>
        <p className="text-sm text-red-600" role="alert">
          Unable to load this opportunity.
        </p>
      </Shell>
    );
  }

  const detail = await getOpportunityDetail({
    workspaceId,
    opportunityId: id,
  });
  if (!detail) {
    return (
      <Shell>
        <p className="text-sm text-zinc-500">Opportunity not found.</p>
        <Link
          href={`/queue?workspaceId=${encodeURIComponent(workspaceId)}`}
          className="text-sm underline"
        >
          Back to queue
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-2">
        <Link
          href={`/queue?workspaceId=${encodeURIComponent(workspaceId)}`}
          className="text-xs font-medium text-zinc-500 underline"
        >
          ← Queue
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{detail.title}</h1>
        <p className="text-sm text-zinc-500">
          {detail.status} · score {detail.score.toFixed(2)} · coverage{" "}
          {detail.coverage}
        </p>
      </div>

      <section className="space-y-2 text-sm">
        <p>
          <span className="font-medium">Why it matters:</span>{" "}
          {detail.whyItMatters}
        </p>
        <p>
          <span className="font-medium">Why now:</span> {detail.whyNow}
        </p>
        <p>
          <span className="font-medium">Recommended action:</span>{" "}
          {detail.recommendedAction}
        </p>
        <p className="text-xs text-zinc-500">
          Features — fit {detail.features.fit.toFixed(2)}, intent{" "}
          {detail.features.intent.toFixed(2)}, evidence{" "}
          {detail.features.evidence.toFixed(2)}, momentum{" "}
          {detail.features.momentum.toFixed(2)}, timing{" "}
          {detail.features.timing.toFixed(2)}, modelConfidence{" "}
          {detail.features.modelConfidence.toFixed(2)}
          {detail.features.lowConfidence ? " (low confidence → review)" : ""}
        </p>
      </section>

      <DraftPanel workspaceId={workspaceId} opportunityId={detail.id} />
      <FeedbackPanel workspaceId={workspaceId} opportunityId={detail.id} />

      <section>
        <h2 className="text-sm font-semibold">
          Evidence ({detail.evidence.length})
        </h2>
        <ul className="mt-3 space-y-3">
          {detail.evidence.map((e) => (
            <li
              key={e.documentId}
              className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <a
                href={e.urlCanonical}
                className="font-medium underline"
                target="_blank"
                rel="noreferrer"
              >
                {e.title || e.urlCanonical}
              </a>
              <p className="mt-1 text-xs text-zinc-500">
                {e.platform}
                {e.provider ? ` · ${e.provider}` : ""}
                {e.postedAt ? ` · ${e.postedAt}` : ""}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {e.contentMd.slice(0, 500)}
                {e.contentMd.length > 500 ? "…" : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-2xl space-y-8 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        {children}
      </main>
    </div>
  );
}
