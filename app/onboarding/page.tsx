import { redirect } from "next/navigation";
import Link from "next/link";

import { PageHead, Shell } from "@/components/shell";

import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";

import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage({
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
      <Shell workspaceId={workspaceId} active="profile">
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Unable to load onboarding for this workspace.
        </p>
      </Shell>
    );
  }

  return (
    <Shell workspaceId={workspaceId} active="profile">
      <PageHead title={"Monitoring profile"} lede={"Describe your AI or dev tool once. Vantage stores a versioned profile used by ranking and drafting, then your free basic scan reads Hacker News, RSS and Substack for people asking for what you build. If the product URL cannot be fetched, mark it inaccessible and paste material manually."} />
      <OnboardingForm workspaceId={workspaceId} />
      <nav className="mt-8 flex gap-4 text-sm">
        <Link href={`/queue?workspaceId=${encodeURIComponent(workspaceId)}`} className="underline">Opportunity queue</Link>
        <Link href={`/settings/sources?workspaceId=${encodeURIComponent(workspaceId)}`} className="underline">Sources &amp; Coverage</Link>
      </nav>
    </Shell>
  );
}
