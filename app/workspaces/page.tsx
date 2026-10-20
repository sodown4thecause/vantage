import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHead, Shell } from "@/components/shell";
import { auth } from "@/lib/auth/server";
import { getCurrentWorkspace, listOwnedWorkspaces } from "@/lib/auth/workspace";

import { SwitchWorkspaceForm } from "./switch-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your workspaces", robots: { index: false, follow: false } };

export default async function WorkspacesPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user?.id) redirect("/setup");
  const [owned, current] = await Promise.all([listOwnedWorkspaces(), getCurrentWorkspace()]);

  return (
    <Shell signedIn>
      <PageHead title="Your workspaces" lede="Choose the product you want to work on. Your selection is remembered in this browser." />
      {owned.length ? (
        <ul className="mb-8 space-y-4">
          {owned.map((row) => (
            <li key={row.id} className="panel p-6">
              <SwitchWorkspaceForm workspaceId={row.id} name={row.name} current={row.id === current?.id} />
            </li>
          ))}
        </ul>
      ) : <p className="mb-8 text-ridge">You haven’t created a workspace yet.</p>}
      <Link href="/setup?new=1" className="btn">Create a workspace</Link>
      <p className="mt-4 text-sm text-ridge">The number of workspaces you can create depends on your plan.</p>
    </Shell>
  );
}
