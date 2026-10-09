import Link from "next/link";

import { DigestSettingsForm } from "@/app/components/DigestSettingsForm";
import { authorizeWorkspace } from "@/lib/auth/workspace";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const { workspaceId } = await searchParams;

  if (!workspaceId) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-zinc-600">
          Pick a workspace from your dashboard to manage its settings.
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
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          You do not have access to this workspace.
        </p>
        <Link href="/" className="text-sm underline">
          Go to your workspaces
        </Link>
      </main>
    );
  }

  const db = getDb();
  const [row] = await db
    .select({
      digestEnabled: workspace.digestEnabled,
      digestEmail: workspace.digestEmail,
      digestHourUtc: workspace.digestHourUtc,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Workspace {workspaceId}
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href={`/sources?workspaceId=${workspaceId}`} className="underline">
            Sources
          </Link>
          <Link href={`/review?workspaceId=${workspaceId}`} className="underline">
            Review queue
          </Link>
        </div>
      </header>

      <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div>
          <h2 className="text-lg font-medium">Daily digest</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Up to five of the highest-ranked conversations from the last 24
            hours, delivered once a day. Vantage never posts on your behalf.
          </p>
        </div>
        {row ? (
          <DigestSettingsForm
            workspaceId={workspaceId}
            enabled={row.digestEnabled}
            email={row.digestEmail}
            hourUtc={row.digestHourUtc}
          />
        ) : (
          <p className="text-sm text-zinc-600">Workspace not found.</p>
        )}
      </section>
    </main>
  );
}
