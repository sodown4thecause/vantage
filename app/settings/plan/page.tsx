import { redirect } from "next/navigation";
import Link from "next/link";

import { PageHead, Shell } from "@/components/shell";
import { eq } from "drizzle-orm";

import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { getPlanUsage } from "@/lib/plans/limits";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";
import { listWorkspaceSources } from "@/lib/sources/list";

export default async function PlanUsagePage({
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
      <Shell workspaceId={workspaceId} active="plan">
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Unable to load plan and usage for this workspace.
        </p>
      </Shell>
    );
  }

  const [profile, sources, owned] = await Promise.all([
    getLatestMonitoringProfile(workspaceId),
    listWorkspaceSources(workspaceId),
    getDb().select({ id: workspace.id }).from(workspace).where(eq(workspace.ownerUserId, authorization.userId)),
  ]);
  const view = await getPlanUsage(workspaceId, {
    keywords: profile?.topics.length ?? 0,
    sources: sources.length,
    projects: owned.length,
  });

  return (
    <Shell workspaceId={workspaceId} active="plan">
      <PageHead title="Plan & usage" />
      <p className="-mt-4 mb-8 max-w-[56ch] text-lg leading-snug text-ridge">
        Current plan: <strong data-testid="plan-name" className="capitalize text-ink">{view.plan}</strong>. Limits are set per plan and can change without a deploy.
      </p>
      <ul className="space-y-3" data-testid="plan-usage">
        {view.usage.map((row) => {
          const pct = row.limit > 0 && row.used != null ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0;
          return (
            <li key={row.key} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" data-testid="plan-usage-row">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium capitalize text-zinc-950 dark:text-zinc-50">{row.label}</span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {row.limit === 0 ? "Not included on this plan" : `${row.used ?? 0} of ${row.limit}`}
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900" aria-hidden="true">
                <div className="h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-50" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Scheduled scans run every {view.limits.scan_interval_hours} hours on this plan.
        {view.limits.reply_briefs > 0 ? "" : " Reply Briefs and 3-hourly alerts are part of Pro."}
      </p>
      {/* /pricing ships with S43/S40; this link 404s until then, so do not release to production users before it lands. */}
      {view.plan === "free" ? (
        <Link href="/pricing" className="inline-block rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">
          Upgrade
        </Link>
      ) : null}
    </Shell>
  );
}
