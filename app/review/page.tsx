import Link from "next/link";

import { CollectNowButton } from "@/app/components/CollectNowButton";
import { LeadActions } from "@/app/components/LeadActions";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { SOURCE_TYPE_LABELS } from "@/lib/collectors/config";
import { listSourcesForWorkspace } from "@/lib/db/sources";
import type { ReviewQueueRow } from "@/lib/pipeline/run";
import {
  countReviewQueue,
  listReviewQueuePage,
} from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";

function documentProvenance(metadata: Record<string, unknown> | null) {
  const provider =
    typeof metadata?.provider === "string" ? metadata.provider : null;
  const mocked = metadata?.mocked === true || provider === "fixture";
  return { provider, mocked };
}

function formatTimestamp(value: Date | null): string {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string; cursor?: string }>;
}) {
  const { workspaceId, cursor } = await searchParams;

  if (!workspaceId) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-zinc-600">
          Pick a workspace from your dashboard to open its queue.
        </p>
        <Link href="/" className="text-sm underline">
          Go to your workspaces
        </Link>
      </main>
    );
  }

  let rows: ReviewQueueRow[] = [];
  let sources: Awaited<ReturnType<typeof listSourcesForWorkspace>> = [];
  let queueCount = 0;
  let nextCursor: string | null = null;
  let error: string | null = null;
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) {
      error = "Unable to load this review queue.";
    } else {
      const page = await listReviewQueuePage({
        workspaceId,
        cursor,
      });
      rows = page.rows;
      nextCursor = page.nextCursor;
      sources = await listSourcesForWorkspace(workspaceId);
      queueCount = await countReviewQueue(workspaceId);
    }
  } catch (err) {
    console.error("[review page] failed to load queue", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    error = "Unable to load this review queue.";
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-zinc-500">
            Workspace {workspaceId} · {queueCount} in queue
          </p>
          <h1 className="text-2xl font-semibold">Review queue</h1>
        </div>
        <Link href="/" className="text-sm underline">
          Go to your workspaces
        </Link>
      </div>
      <Link
        href={`/sources?workspaceId=${workspaceId}`}
        className="text-sm underline"
      >
        Manage sources
      </Link>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {!error && rows.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No leads yet. Collect from a source above, then Vantage ranks what it
          finds for review.
        </p>
      ) : null}

      {!error && sources.length > 0 ? (
        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Sources ({sources.length})
          </h2>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sources.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {s.name}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {SOURCE_TYPE_LABELS[s.type]} ·{" "}
                    <span className="uppercase">{s.health}</span> · last polled{" "}
                    {formatTimestamp(s.lastPolledAt)}
                  </p>
                </div>
                <CollectNowButton
                  workspaceId={workspaceId}
                  sourceId={s.id}
                  sourceType={s.type}
                  sourceName={s.name}
                  disabled={s.health === "paused"}
                />
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">
            Vantage also sweeps every source automatically on a schedule.
          </p>
        </section>
      ) : null}

      <ul className="space-y-3">
        {rows.map(({ lead: l, document: d }) => {
          const provenance = documentProvenance(d.metadata);
          return (
            <li
              key={l.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-900">
                  rung {l.intentRung}
                </span>
                <span>score {l.score}</span>
                <span>conf {l.confidence}</span>
                <span>{d.platform}</span>
                <span className="uppercase">{l.status}</span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-900">
                  via {provenance.provider ?? "unknown"}
                </span>
                {provenance.mocked ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    sample data
                  </span>
                ) : null}
              </div>
              <h2 className="mt-2 text-lg font-medium">
                <a
                  href={d.urlCanonical}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {d.title || d.urlCanonical}
                </a>
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {l.reason}
              </p>
              <p className="mt-2 line-clamp-3 text-sm text-zinc-700 dark:text-zinc-300">
                {d.contentMd}
              </p>
              <div className="mt-3">
                <LeadActions workspaceId={workspaceId} leadId={l.id} />
              </div>
            </li>
          );
        })}
      </ul>

      {nextCursor ? (
        <div className="pt-2">
          <Link
            href={`/review?workspaceId=${workspaceId}&cursor=${encodeURIComponent(nextCursor)}`}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Load more
          </Link>
        </div>
      ) : null}
    </main>
  );
}
