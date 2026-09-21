import Link from "next/link";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { listWorkspaceSources } from "@/lib/sources/list";

export default async function SourcesCoveragePage({
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
          to view Sources &amp; Coverage.
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-zinc-900 underline dark:text-zinc-50"
        >
          Back home
        </Link>
      </Shell>
    );
  }

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return (
      <Shell>
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Unable to load sources for this workspace.
        </p>
      </Shell>
    );
  }

  const sources = await listWorkspaceSources(workspaceId);

  return (
    <Shell>
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Settings · secondary
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Sources &amp; Coverage
        </h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Last scan, coverage status, result counts, and provider provenance.
          Fixture-only runs are marked degraded — never as healthy live coverage.
        </p>
      </div>

      {sources.length === 0 ? (
        <p className="text-sm text-zinc-500" data-testid="sources-empty">
          No sources configured for this workspace yet.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="sources-list">
          {sources.map((s) => {
            const coverage = s.coverage ?? s.health;
            const reason = s.lastRun?.reason ?? "No scan receipt yet.";
            const resultCount = s.lastRun?.resultCount;
            return (
              <li
                key={s.id}
                className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                data-testid="source-row"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-zinc-950 dark:text-zinc-50">
                      {s.name}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {s.type} · {s.lane}
                      {s.collectorRegistered ? "" : " · no collector registered"}
                    </p>
                  </div>
                  <span
                    className={badgeClass(coverage)}
                    data-testid="source-coverage"
                  >
                    {coverage}
                  </span>
                </div>
                <dl className="mt-3 grid gap-2 text-xs text-zinc-600 dark:text-zinc-400 sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-zinc-800 dark:text-zinc-200">
                      Last scan
                    </dt>
                    <dd>{s.lastPolledAt ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-zinc-800 dark:text-zinc-200">
                      Results
                    </dt>
                    <dd>
                      {resultCount == null
                        ? "—"
                        : `${resultCount} docs · ${s.lastRun?.inserted ?? 0} inserted · ${s.lastRun?.skipped ?? 0} skipped`}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-zinc-800 dark:text-zinc-200">
                      Provider
                    </dt>
                    <dd>
                      <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">
                        {s.lastRun?.provider ?? "—"}
                      </code>
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-medium text-zinc-800 dark:text-zinc-200">
                      Reason
                    </dt>
                    <dd data-testid="source-reason">{reason}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href={`/onboarding?workspaceId=${encodeURIComponent(workspaceId)}`}
          className="font-medium text-zinc-900 underline dark:text-zinc-50"
        >
          Onboarding
        </Link>
        <Link
          href={`/review?workspaceId=${encodeURIComponent(workspaceId)}`}
          className="font-medium text-zinc-900 underline dark:text-zinc-50"
        >
          Review queue
        </Link>
      </div>
    </Shell>
  );
}

function badgeClass(coverage: string): string {
  const base =
    "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize";
  switch (coverage) {
    case "healthy":
      return `${base} bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100`;
    case "degraded":
    case "budget_limited":
      return `${base} bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100`;
    case "access_pending":
    case "paused":
      return `${base} bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100`;
    case "blocked":
    case "failed":
    case "failing":
      return `${base} bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100`;
    default:
      return `${base} bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200`;
  }
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
