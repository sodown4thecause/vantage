import Link from "next/link";

import { Shell } from "@/components/shell";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { listReviewQueue } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const { workspaceId } = await searchParams;

  if (!workspaceId) {
    return (
      <Shell>
        <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-zinc-600">
          Pass <code className="rounded bg-zinc-100 px-1">?workspaceId=…</code>{" "}
          to load leads.
        </p>
        <Link href="/" className="link">
          Home
        </Link>
        </div>
      </Shell>
    );
  }

  let rows: Awaited<ReturnType<typeof listReviewQueue>> = [];
  let error: string | null = null;
  try {
    const authorization = await authorizeWorkspace(workspaceId);
    if (!authorization.ok) {
      error = "Unable to load this review queue.";
    } else {
      rows = await listReviewQueue(workspaceId);
    }
  } catch (err) {
    console.error("[review page] failed to load queue", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    error = "Unable to load this review queue.";
  }

  return (
    <Shell workspaceId={workspaceId} wide>
      <div className="mb-8">
        <h1 className="display text-4xl">Review queue</h1>
        <p className="text-sm text-ridge">Workspace {workspaceId}</p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {!error && rows.length === 0 ? (
        <p className="text-zinc-600">
          No leads yet. Run collectors, then{" "}
          <code className="rounded bg-zinc-100 px-1">POST /api/pipeline/run</code>.
        </p>
      ) : null}

      <ul className="space-y-3">
        {rows.map(({ lead: l, document: d }) => (
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
              <span>{l.status}</span>
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
          </li>
        ))}
      </ul>
    </Shell>
  );
}
