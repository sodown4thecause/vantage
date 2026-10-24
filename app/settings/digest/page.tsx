import { redirect } from "next/navigation";

import { PageHead, Shell } from "@/components/shell";
import { eq } from "drizzle-orm";

import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { formatHour } from "@/lib/onboarding/interview";
import { DigestSettingsForm } from "@/app/components/DigestSettingsForm";

export const dynamic = "force-dynamic";

export default async function DigestSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const params = await searchParams;
  const workspaceId =
    params.workspaceId?.trim() || (await getCurrentWorkspace())?.id;
  if (!workspaceId) redirect("/");

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return (
      <Shell workspaceId={workspaceId} active="digest">
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Unable to load digest settings for this workspace.
        </p>
      </Shell>
    );
  }

  const [row] = await getDb()
    .select({
      digestEnabled: workspace.digestEnabled,
      digestEmail: workspace.digestEmail,
      digestHourUtc: workspace.digestHourUtc,
      digestLocalHour: workspace.digestLocalHour,
      digestTimeZone: workspace.digestTimeZone,
      productEmailSuppressedAt: workspace.productEmailSuppressedAt,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  return (
    <Shell workspaceId={workspaceId} active="digest">
      <PageHead title="Daily digest" />
      <p className="-mt-4 mb-8 max-w-[56ch] text-lg leading-snug text-ridge">
        Up to five of the highest-ranked conversations from the last 24 hours,
        delivered once a day. contextfor.dev never posts on your behalf.
      </p>
      {row?.digestTimeZone && row.digestLocalHour !== null && (
        <p className="mb-6 max-w-[56ch] text-sm text-ridge" role="status">
          Your digest arrives at {formatHour(row.digestLocalHour)} {row.digestTimeZone} and follows daylight saving.
          Choosing a different hour below replaces this with a fixed UTC hour.
        </p>
      )}
      {row?.productEmailSuppressedAt ? (
        <p role="status" className="max-w-[56ch] text-ridge">You’re unsubscribed from Vantage product emails for this workspace. Digests and activation emails are suppressed, even if an older delivery preference is enabled.</p>
      ) : row ? (
        <DigestSettingsForm
          workspaceId={workspaceId}
          enabled={row.digestEnabled}
          email={row.digestEmail}
          hourUtc={row.digestHourUtc}
        />
      ) : (
        <p className="text-sm text-ridge">Workspace not found.</p>
      )}
    </Shell>
  );
}
