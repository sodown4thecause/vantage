import { redirect } from "next/navigation";
import Link from "next/link";

import { PageHead, Shell } from "@/components/shell";

import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { listWorkspaceSources } from "@/lib/sources/list";
import { CommunitySourceForm, FeedForm, SourceScanButton } from "@/app/source-controls";

export default async function SourcesCoveragePage({
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
      <Shell workspaceId={workspaceId} active="sources">
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Unable to load sources for this workspace.
        </p>
      </Shell>
    );
  }

  const sources = await listWorkspaceSources(workspaceId);

  return (
    <Shell workspaceId={workspaceId} active="sources">
      <PageHead title={"Sources & Coverage"} lede={"Last scan, coverage status, result counts, and provider provenance. Fixture-only runs are marked degraded, never as healthy live coverage."} />

      <FeedForm workspaceId={workspaceId} />
      <CommunitySourceForm workspaceId={workspaceId} />

      {sources.length === 0 ? (
        <p className="text-sm text-zinc-500" data-testid="sources-empty">
          No sources configured for this workspace yet.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="sources-list">
          {sources.map((s) => {
            const coverage =
              s.displayCoverage === "paused_global"
                ? "paused_global"
                : s.health === "paused"
                  ? "paused"
                  : s.coverage ?? "awaiting_scan";
            const reason = s.pausedLabel ?? s.lastRun?.reason ?? "No scan receipt yet.";
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
                    {coverage === "paused_global" ? "paused" : coverage}
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
                <SourceScanButton workspaceId={workspaceId} sourceId={s.id} />
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
          href={`/settings/plan?workspaceId=${encodeURIComponent(workspaceId)}`}
          className="font-medium text-zinc-900 underline dark:text-zinc-50"
        >
          Plan &amp; usage
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
    case "paused_global":
      return `${base} bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100`;
    case "blocked":
    case "failed":
    case "failing":
      return `${base} bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100`;
    default:
      return `${base} bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200`;
  }
}
