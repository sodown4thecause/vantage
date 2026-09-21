import Link from "next/link";

import { authorizeWorkspace } from "@/lib/auth/workspace";

import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage({
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
          to complete the five-minute monitoring profile.
        </p>
        <Link href="/" className="text-sm font-medium text-zinc-900 underline dark:text-zinc-50">
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
          Unable to load onboarding for this workspace.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Slice 1 · Onboarding
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Monitoring profile
        </h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Describe your product once. Vantage stores a versioned profile used by
          ranking and drafting. If the product URL cannot be fetched, mark it
          inaccessible and paste material manually.
        </p>
      </div>
      <OnboardingForm workspaceId={workspaceId} />
    </Shell>
  );
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
