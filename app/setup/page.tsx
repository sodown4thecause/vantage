import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHead, Shell } from "@/components/shell";
import { auth } from "@/lib/auth/server";
import { getCurrentWorkspace } from "@/lib/auth/workspace";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";

import { WorkspaceForm } from "./workspace-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workspace setup", robots: { index: false, follow: false } };

export default async function SetupPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user?.id) {
    return (
      <Shell>
        <PageHead title="We couldn’t confirm your sign-in." lede="Your session is missing or has expired. Sign in again to continue to your workspace." />
        <p className="mb-6 text-ridge">If this keeps happening, make sure your browser allows cookies for this site.</p>
        <Link href="/auth/sign-in" className="btn">Sign in again</Link>
      </Shell>
    );
  }

  const workspace = await getCurrentWorkspace();
  if (workspace) {
    const profile = await getLatestMonitoringProfile(workspace.id);
    redirect(`/${profile ? "queue" : "onboarding"}?workspaceId=${encodeURIComponent(workspace.id)}`);
  }

  return (
    <Shell signedIn>
      <div className="mx-auto max-w-lg">
        <p className="eyebrow mb-4">Account ready · Step 1 of 2</p>
        <PageHead title="Create your workspace" lede="You’re signed in. Give your workspace a name, then tell us about the product you want to monitor." />
        <div className="panel p-6 sm:p-8">
          <WorkspaceForm />
        </div>
        <p className="mt-6 text-sm text-ridge">Next: set up your monitoring profile. No payment details needed.</p>
      </div>
    </Shell>
  );
}
