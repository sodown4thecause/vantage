import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHead, Shell } from "@/components/shell";
import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";

export const metadata: Metadata = { title: "Content", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ workspaceId?: string }> }) {
  const params = await searchParams;
  const workspaceId = params.workspaceId?.trim() || (await getCurrentWorkspace())?.id;
  if (!workspaceId) redirect("/");
  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) return <Shell><p role="alert" className="text-stop">Unable to load this workspace.</p></Shell>;
  const q = `?workspaceId=${encodeURIComponent(workspaceId)}`;
  return <Shell workspaceId={workspaceId} active="content" wide>
    <PageHead title="Give the right idea a useful home." lede="Turn what your audience asks into content worth reading. Research and briefs are available now; saved drafts and the full blog workflow are coming next." />
    <section className="rounded-xl border border-contour bg-sheet p-6 sm:p-8" aria-labelledby="content-start">
      <span className="text-2xl text-signal" aria-hidden="true">▤</span>
      <h2 id="content-start" className="mt-5 text-2xl font-medium">Start with a question worth answering.</h2>
      <p className="mt-3 max-w-xl text-sm leading-7 text-ridge">Your research assistant can find topic gaps, compare search results and plan a blog brief. It does not yet save or publish blog posts.</p>
      <div className="mt-6 flex flex-wrap gap-3"><Link className="btn" href={`/seo${q}`}>Research a topic →</Link><Link className="btn btn-quiet" href={`/queue${q}`}>Look at audience questions</Link></div>
    </section>
    <ol className="mt-8 divide-y divide-contour border-y border-contour" aria-label="Content workflow">
      {[
        ["01", "Find the question", "Use conversation evidence and keyword research to pick a useful topic.", "Available"],
        ["02", "Shape the brief", "Ask the research assistant for an angle, target keywords and an outline.", "Available"],
        ["03", "Write, review and publish", "A saved drafting and editing workflow, with you approving the final post.", "Coming next"],
      ].map(([number, title, description, state]) => <li key={number} className="flex gap-5 py-6"><span className="pt-1 text-xs text-ridge">{number}</span><div className="flex-1"><h3 className="text-sm font-medium">{title}</h3><p className="mt-2 text-sm leading-6 text-ridge">{description}</p></div><span className="text-xs text-ridge">{state}</span></li>)}
    </ol>
  </Shell>;
}
