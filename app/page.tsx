import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getCurrentWorkspace } from "@/lib/auth/workspace";
import { createWorkspaceForCurrentUser } from "@/lib/db/actions";
import { getLatestMonitoringProfile } from "@/lib/profile/repository";

export const dynamic = "force-dynamic";

async function startWorkspace(form: FormData) {
  "use server";
  const workspace = await createWorkspaceForCurrentUser(String(form.get("name") ?? ""));
  if (!workspace) throw new Error("Workspace could not be created.");
  redirect(`/onboarding?workspaceId=${encodeURIComponent(workspace.id)}`);
}

export default async function Home() {
  const { data: session } = await auth.getSession();
  const workspace = session?.user ? await getCurrentWorkspace() : null;
  if (workspace) {
    const profile = await getLatestMonitoringProfile(workspace.id);
    redirect(`/${profile ? "queue" : "onboarding"}?workspaceId=${encodeURIComponent(workspace.id)}`);
  }
  return (
    <main className="mx-auto my-16 w-full max-w-2xl space-y-6 rounded-2xl border border-zinc-200 p-8">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">VANTAGE</p>
      <h1 className="text-3xl font-semibold">Find the conversations that matter to your product.</h1>
      <p>Describe your product, follow relevant sources, and review a small queue of opportunities backed by evidence.</p>
      {session?.user ? (
        <form action={startWorkspace} className="space-y-3">
          <label htmlFor="workspace-name" className="block font-medium">Workspace name</label>
          <input id="workspace-name" name="name" required maxLength={100} autoComplete="organization" className="w-full rounded border p-3" />
          <button className="rounded bg-zinc-900 px-5 py-3 text-white">Create workspace</button>
        </form>
      ) : (
        <div className="flex gap-4">
          <Link href="/auth/sign-up" className="rounded bg-zinc-900 px-5 py-3 text-white">Create account</Link>
          <Link href="/auth/sign-in" className="rounded border px-5 py-3">Sign in</Link>
        </div>
      )}
    </main>
  );
}
