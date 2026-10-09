import Link from "next/link";

import { CreateWorkspaceForm } from "@/app/components/CreateWorkspaceForm";
import { auth } from "@/lib/auth/server";
import { listWorkspacesForUser } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;

  if (!userId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-24 font-sans dark:bg-black">
        <main className="w-full max-w-2xl space-y-8 rounded-2xl border border-zinc-200 bg-white p-10 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Vantage
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Find the people already asking for what you build
            </h1>
            <p className="text-base leading-7 text-zinc-600 dark:text-zinc-400">
              Vantage reads Reddit, Hacker News, X, YouTube, Product Hunt and
              your own feeds, then ranks the conversations worth joining. You
              write the reply — Vantage never posts for you.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/auth/sign-up"
              className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Create free account
            </Link>
            <Link
              href="/auth/sign-in"
              className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Sign in
            </Link>
          </div>
        </main>
      </div>
    );
  }

  let workspaces: Awaited<ReturnType<typeof listWorkspacesForUser>> = [];
  let loadError: string | null = null;
  try {
    workspaces = await listWorkspacesForUser(String(userId));
  } catch (err) {
    console.error("[home] failed to load workspaces", {
      error: err instanceof Error ? err.message : String(err),
    });
    loadError = "Could not load your workspaces. Please refresh.";
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-3xl space-y-8">
        <header className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Your workspaces
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Each workspace has its own sources, queue and digest.
            </p>
          </div>
          <Link
            href="/auth/sign-out"
            className="text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Sign out
          </Link>
        </header>

        {loadError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {loadError}
          </p>
        ) : null}

        {!loadError && workspaces.length === 0 ? (
          <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="space-y-2">
              <h2 className="text-lg font-medium text-zinc-950 dark:text-zinc-50">
                Create your first workspace
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Name it after the product or brand you want to monitor. Next
                you&apos;ll add sources, then Vantage starts surfacing the
                conversations worth joining.
              </p>
            </div>
            <CreateWorkspaceForm />
          </section>
        ) : null}

        {workspaces.length > 0 ? (
          <>
            <ul className="space-y-3">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/review?workspaceId=${w.id}`}
                    className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
                  >
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {w.name}
                    </span>
                    <span className="text-sm text-zinc-500">
                      {w.plan} · open queue
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Manage a workspace&apos;s sources from its{" "}
              <Link href="/sources" className="underline">
                sources page
              </Link>
              .
            </p>
            <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
                New workspace
              </h2>
              <CreateWorkspaceForm compact />
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
