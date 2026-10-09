import Link from "next/link";

import { SourceForm } from "@/app/components/SourceForm";
import { SourceStatusToggle } from "@/app/components/SourceStatusToggle";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { SOURCE_TYPE_LABELS } from "@/lib/collectors/config";
import { listSourcesForWorkspace } from "@/lib/db/sources";

export const dynamic = "force-dynamic";

function formatTimestamp(value: Date | null): string {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const { workspaceId } = await searchParams;

  if (!workspaceId) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Sources</h1>
        <p className="text-zinc-600">
          Pick a workspace from your dashboard to manage its sources.
        </p>
        <Link href="/" className="text-sm underline">
          Go to your workspaces
        </Link>
      </main>
    );
  }

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Sources</h1>
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          You do not have access to this workspace.
        </p>
        <Link href="/" className="text-sm underline">
          Go to your workspaces
        </Link>
      </main>
    );
  }

  const sources = await listSourcesForWorkspace(workspaceId);

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Sources</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Where Vantage looks for conversations about your product.
          </p>
        </div>
        <Link
          href={`/review?workspaceId=${workspaceId}`}
          className="text-sm underline"
        >
          Review queue
        </Link>
      </header>

      <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Add a source
        </h2>
        <SourceForm workspaceId={workspaceId} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Configured sources ({sources.length})
        </h2>
        {sources.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            No sources yet. Add one above, then run a collection from the review
            queue.
          </p>
        ) : (
          <ul className="space-y-3">
            {sources.map((s) => {
              const paused = s.health === "paused";
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                      {s.name}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {SOURCE_TYPE_LABELS[s.type]} ·{" "}
                      <span className="uppercase">{s.health}</span> · last polled{" "}
                      {formatTimestamp(s.lastPolledAt)}
                    </p>
                  </div>
                  <SourceStatusToggle
                    workspaceId={workspaceId}
                    sourceId={s.id}
                    sourceName={s.name}
                    paused={paused}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
