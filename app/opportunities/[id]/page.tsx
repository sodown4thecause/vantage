import Link from "next/link";

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { getOpportunityDetail } from "@/lib/opportunities/run";

import { safeHttpUrl } from "@/lib/http/safe-url";
import { Glyph } from "@/components/glyph";
import { Shell } from "@/components/shell";

import { DraftPanel } from "./draft-panel";
import { FeedbackPanel } from "./feedback-panel";
import { PlaysPanel } from "./plays-panel";

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const workspaceId = sp.workspaceId?.trim();

  if (!workspaceId) {
    return (
      <Shell>
        <p className="text-ridge">Open this opportunity from your queue so Vantage knows which workspace it belongs to.</p>
      </Shell>
    );
  }

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return (
      <Shell workspaceId={workspaceId}>
        <p className="text-stop" role="alert">
          Unable to load this opportunity.
        </p>
      </Shell>
    );
  }

  const detail = await getOpportunityDetail({
    workspaceId,
    opportunityId: id,
  });
  if (!detail) {
    return (
      <Shell workspaceId={workspaceId} active="queue">
        <p className="mb-3 text-xl font-semibold">This opportunity is no longer in your queue.</p>
        <Link
          href={`/queue?workspaceId=${encodeURIComponent(workspaceId)}`}
          className="link"
        >
          Back to queue
        </Link>
      </Shell>
    );
  }

  const f = detail.features;
  const axes = [
    ["Fit", f.fit],
    ["Intent", f.intent],
    ["Evidence", f.evidence],
    ["Momentum", f.momentum],
    ["Timing", f.timing],
  ] as const;

  return (
    <Shell workspaceId={workspaceId} active="queue" wide>
      <Link
        href={`/queue?workspaceId=${encodeURIComponent(workspaceId)}`}
        className="link text-sm text-ridge"
      >
        Back to queue
      </Link>

      <div className="mt-6 grid items-start gap-x-14 gap-y-12 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-10">
          <header className="space-y-3">
            <h1 className="display text-3xl sm:text-4xl">{detail.title}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ridge">
              <span className="rounded-full px-2.5 py-0.5 font-medium capitalize text-ink shadow-[inset_0_0_0_1px_var(--contour)]">
                {detail.status}
              </span>
              <span>Score <b className="text-ink">{detail.score.toFixed(2)}</b></span>
              <span>Coverage {detail.coverage}</span>
              {f.lowConfidence && (
                <span className="rounded-full bg-flag px-2.5 py-0.5 font-semibold text-[#3a2800]">
                  Low confidence: check before acting
                </span>
              )}
            </div>
          </header>

          <section className="space-y-5 text-[1.0625rem] leading-snug">
            <div>
              <h2 className="font-semibold">Why it matters</h2>
              <p className="max-w-[62ch] text-ridge">{detail.whyItMatters}</p>
            </div>
            <div>
              <h2 className="font-semibold">Why now</h2>
              <p className="max-w-[62ch] text-ridge">{detail.whyNow}</p>
            </div>
            <div>
              <h2 className="font-semibold">Recommended next step</h2>
              <p className="max-w-[62ch] text-ridge">{detail.recommendedAction}</p>
            </div>
          </section>

          <PlaysPanel workspaceId={workspaceId} opportunityId={detail.id} />
          <DraftPanel workspaceId={workspaceId} opportunityId={detail.id} conversations={detail.evidence.map(({ documentId, title, urlCanonical, platform, discoveryOnly }) => ({ documentId, title, urlCanonical, platform, discoveryOnly }))} />
          <FeedbackPanel workspaceId={workspaceId} opportunityId={detail.id} />
        </div>

        <aside className="min-w-0 space-y-10 lg:sticky lg:top-6">
          <section aria-labelledby="score-heading" className="space-y-3">
            <h2 id="score-heading" className="font-semibold">How it scored</h2>
            <div className="mx-auto max-w-[17rem]">
              <Glyph features={f} size={272} labels />
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
              {axes.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ridge">{k}</dt>
                  <dd className="font-semibold">{v.toFixed(2)}</dd>
                </div>
              ))}
              <div className="contents">
                <dt className="text-ridge">Model confidence</dt>
                <dd className="font-semibold">{f.modelConfidence.toFixed(2)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="evidence-heading">
            <h2 id="evidence-heading" className="font-semibold">
              What people said ({detail.evidence.length})
            </h2>
            <ul className="mt-4 space-y-6">
              {detail.evidence.map((e) => {
                const href = safeHttpUrl(e.urlCanonical);
                return (
                <li key={e.documentId} className="space-y-2 border-l-2 border-signal pl-4">
                  {href ? (
                    <a
                      href={href}
                      className="link font-semibold leading-snug"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {e.title || e.urlCanonical}
                    </a>
                  ) : (
                    <span className="font-semibold leading-snug">{e.title || "Source link unavailable"}</span>
                  )}
                  <p className="text-sm text-ridge">
                    {[e.platform, e.provider, e.postedAt].filter(Boolean).join(", ")}
                  </p>
                  <p className="quote whitespace-pre-wrap">
                    {e.contentMd.slice(0, 500)}
                    {e.contentMd.length > 500 ? "…" : ""}
                  </p>
                </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </Shell>
  );
}
