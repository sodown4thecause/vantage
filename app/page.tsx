import Link from "next/link";

import { Glyph } from "@/components/glyph";
import { Shell } from "@/components/shell";
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
  const example = { fit: 0.86, intent: 0.78, evidence: 0.64, momentum: 0.45, timing: 0.9 };
  return (
    <Shell wide>
      <div className="grid items-center gap-x-14 gap-y-12 lg:grid-cols-[1.15fr_1fr]">
        <section className="space-y-7">
          <h1 className="display text-5xl sm:text-6xl lg:text-7xl">
            Up to five conversations worth joining, every day.
          </h1>
          <p className="max-w-[48ch] text-lg leading-snug text-ridge">
            Vantage reads Reddit, Hacker News, X and more for people asking for
            what you build. You get a short ranked list with the posts that
            prove it. You write the reply. Vantage never posts for you.
          </p>
          {session?.user ? (
            <form action={startWorkspace} className="max-w-md space-y-3">
              <label htmlFor="workspace-name" className="block font-semibold">
                Name your workspace
              </label>
              <input
                id="workspace-name"
                name="name"
                required
                maxLength={100}
                autoComplete="organization"
                placeholder="Acme Analytics"
                className="w-full rounded-md border px-3.5 py-3"
              />
              <button className="btn">Create workspace</button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Link href="/auth/sign-up" className="btn">
                Create a free account
              </Link>
              <Link href="/auth/sign-in" className="btn btn-quiet">
                Sign in
              </Link>
            </div>
          )}
        </section>

        <aside aria-label="Example opportunity" className="space-y-5">
          <div className="mx-auto w-full max-w-[22rem]">
            <Glyph features={example} size={352} labels animate />
          </div>
          <div className="space-y-2 border-t border-contour pt-4">
            <p className="text-sm text-ridge">Example opportunity</p>
            <p className="text-xl font-semibold leading-snug tracking-tight">
              Founder asks for a cheaper way to track brand mentions in AI answers
            </p>
            <p className="max-w-[52ch] text-ridge">
              Posted 3 hours ago in a thread with 40 replies. The scores show
              why it ranked: a strong fit with your product, a clear request,
              and good timing.
            </p>
          </div>
        </aside>
      </div>

      <section className="mt-20 grid gap-x-12 gap-y-8 border-t border-contour pt-10 sm:grid-cols-2">
        <h2 className="display text-3xl sm:text-4xl">What the five scores mean</h2>
        <dl className="space-y-4">
          {[
            ["Fit", "How closely the poster's problem matches your product."],
            ["Intent", "Whether they are asking for a solution or just venting."],
            ["Evidence", "How many posts and sources back the opportunity."],
            ["Momentum", "Whether the conversation is still growing."],
            ["Timing", "How recent it is, so a reply still lands."],
          ].map(([term, def]) => (
            <div key={term} className="grid grid-cols-[6.5rem_1fr] gap-4">
              <dt className="font-semibold">{term}</dt>
              <dd className="text-ridge">{def}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Shell>
  );
}
