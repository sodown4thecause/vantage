import Link from "next/link";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { listOpportunityQueue } from "@/lib/opportunities/run";

export default async function OpportunityQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const params = await searchParams;
  const workspaceId = params.workspaceId?.trim();

  if (!workspaceId) {
    return (
      <Shell>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Pass{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">
            ?workspaceId=…
          </code>{" "}
          to open the Opportunity Queue.
        </p>
        <Link href="/" className="text-sm font-medium underline">
          Back home
        </Link>
      </Shell>
    );
  }

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return (
      <Shell>
        <p className="text-sm text-red-600" role="alert">
          Unable to load this opportunity queue.
        </p>
      </Shell>
    );
  }

  const cards = await listOpportunityQueue({ workspaceId, limit: 5 });

  return (
    <Shell>
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Slice 3 · Queue
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Opportunity Queue
        </h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          At most five evidence-backed opportunities. Empty is a valid state.
          Run{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">
            POST /api/opportunities/run
          </code>{" "}
          after collectors to refresh.
        </p>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-zinc-500" data-testid="queue-empty">
          No strong opportunities right now.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="queue-list">
          {cards.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={`/opportunities/${c.id}?workspaceId=${encodeURIComponent(workspaceId)}`}
                    className="font-medium text-zinc-950 underline-offset-2 hover:underline dark:text-zinc-50"
                  >
                    {c.title}
                  </Link>
                  <p className="mt-1 text-xs text-zinc-500">
                    {c.status} · score {c.score.toFixed(2)} · {c.evidenceCount}{" "}
                    evidence · conf {c.confidence.toFixed(2)}
                  </p>
                </div>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs capitalize dark:bg-zinc-900">
                  {c.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                {c.whyItMatters}
              </p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="font-medium">Why now:</span> {c.whyNow}
              </p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="font-medium">Next:</span>{" "}
                {c.recommendedAction}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                fit {c.features.fit.toFixed(2)} · intent{" "}
                {c.features.intent.toFixed(2)} · evidence{" "}
                {c.features.evidence.toFixed(2)} · momentum{" "}
                {c.features.momentum.toFixed(2)} · timing{" "}
                {c.features.timing.toFixed(2)}
              </p>
            </li>
          ))}
        </ul>
      )}
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
