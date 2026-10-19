import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { authorizeWorkspace, getCurrentWorkspace } from "@/lib/auth/workspace";
import { normalizeTarget, peekBacklinkReport, referringDomainGap } from "@/lib/dataforseo/backlinks";
import { checkLimit } from "@/lib/plans/limits";
import { PageHead, Shell } from "@/components/shell";
import { runBacklinkReport } from "./actions";

export const metadata: Metadata = { title: "SEO", robots: { index: false } };

export const dynamic = "force-dynamic";

const PAUSED = "SEO lookups are paused for today. Try again tomorrow.";
const ERRORS: Record<string, string> = {
  forbidden: "Unable to load this page.",
  not_configured: "SEO data is not set up yet.",
  credits_exhausted: "You have used this month's SEO credits. They reset on the 1st (UTC); Pro includes more.",
  reserve_floor: PAUSED,
  balance_unknown: PAUSED,
  daily_cap: PAUSED,
  paused: PAUSED,
  invalid_target: "Enter a domain like example.com.",
  failed: "That lookup failed. You were not charged a credit.",
};

function messageFor(code: string | undefined): string | undefined {
  return code && Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : undefined;
}

const count = (value: number) => value.toLocaleString("en-US");
const day = (value: string | null) => (value ? value.slice(0, 10) : "Unknown");

async function creditsLeft(workspaceId: string): Promise<number | null> {
  try {
    return (await checkLimit(workspaceId, "seo_credits_per_month")).remaining;
  } catch (err) {
    console.error("[seo] credit check failed", { error: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}

/**
 * Read-only: renders only what the cache already holds. Lookups run in the server action, never here,
 * so a GET or prefetch of this page cannot spend credits.
 */
export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string; target?: string; competitor?: string; error?: string }>;
}) {
  const params = await searchParams;
  const workspaceId = params.workspaceId?.trim() || (await getCurrentWorkspace())?.id;

  if (!workspaceId) redirect("/");

  const authorization = await authorizeWorkspace(workspaceId);
  if (!authorization.ok) {
    return (
      <Shell workspaceId={workspaceId} active="seo">
        <p className="text-stop" role="alert">
          {ERRORS.forbidden}
        </p>
      </Shell>
    );
  }

  // Anything that does not normalize is ignored, so only a bare public hostname is ever peeked.
  const target = params.target ? normalizeTarget(params.target) : null;
  const competitor = params.competitor ? normalizeTarget(params.competitor) : null;
  const [report, rival, credits] = await Promise.all([
    target ? peekBacklinkReport(target) : null,
    competitor ? peekBacklinkReport(competitor) : null,
    creditsLeft(workspaceId),
  ]);

  const summary = report?.summary && report.summary.target !== "" ? report.summary : null;
  const gap =
    report?.referringDomains && rival?.referringDomains
      ? referringDomainGap(report.referringDomains, rival.referringDomains, target ?? "")
      : null;
  const message = messageFor(params.error);
  const sandbox = process.env.DATAFORSEO_ENV !== "live";

  return (
    <Shell workspaceId={workspaceId} active="seo" wide>
      <PageHead
        title="SEO"
        lede="Backlinks for one domain: who links to it, with what anchor text, and which of a competitor's linking sites it is missing."
      />
      {message && (
        <p role="alert" className="mb-8 rounded border border-contour bg-sheet p-4 text-sm">
          {message}
        </p>
      )}

      <form action={runBacklinkReport} className="mb-10 grid gap-4 sm:grid-cols-2" data-testid="seo-form">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <label className="grid content-start gap-1.5 text-sm font-semibold">
          Domain
          <input
            name="target"
            required
            defaultValue={params.target ?? ""}
            placeholder="example.com"
            className="w-full rounded border border-contour bg-transparent p-3 font-normal"
          />
        </label>
        <label className="grid content-start gap-1.5 text-sm font-semibold">
          Competitor <span className="font-normal text-ridge">(optional)</span>
          <input
            name="competitor"
            defaultValue={params.competitor ?? ""}
            placeholder="competitor.com"
            className="w-full rounded border border-contour bg-transparent p-3 font-normal"
          />
        </label>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:col-span-2">
          <button className="btn">Run lookup</button>
          {credits !== null && <p className="text-sm text-ridge">SEO credits left this month: {credits}</p>}
        </div>
      </form>

      {target && !summary && (
        <p className="text-ridge" data-testid="seo-empty">No data yet for this domain. Run a lookup.</p>
      )}

      {target && summary && (
        <div className="space-y-12" data-testid="seo-report">
          {sandbox && <p className="text-sm font-semibold text-ridge">Sandbox data: not real figures.</p>}

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight">{target}</h2>
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
              {(
                [
                  ["Domain rank", count(summary.rank)],
                  ["Backlinks", count(summary.backlinks)],
                  ["Referring domains", count(summary.referringDomains)],
                  ["Referring main domains", count(summary.referringMainDomains)],
                  ["Broken backlinks", count(summary.brokenBacklinks)],
                  ["Spam score", count(summary.spamScore)],
                  ["First seen", day(summary.firstSeen)],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase tracking-wide text-ridge">{label}</dt>
                  <dd className="text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Referring domains</h2>
            {!report?.referringDomains ? (
              <p className="text-ridge">No referring domains yet. Run a lookup.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-contour text-ridge">
                      <th scope="col" className="py-2 pr-4 font-medium">Domain</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Rank</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Backlinks</th>
                      <th scope="col" className="py-2 pr-4 font-medium">First seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.referringDomains.slice(0, 100).map((row, i) => (
                      <tr key={`${i}-${row.domain}`} className="border-b border-contour">
                        <td className="break-all py-2 pr-4">{row.domain}</td>
                        <td className="py-2 pr-4">{count(row.rank)}</td>
                        <td className="py-2 pr-4">{count(row.backlinks)}</td>
                        <td className="py-2 pr-4">{day(row.firstSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Anchor text</h2>
            {!report?.anchors ? (
              <p className="text-ridge">No anchor text yet. Run a lookup.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-contour text-ridge">
                      <th scope="col" className="py-2 pr-4 font-medium">Anchor</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Backlinks</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Referring domains</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.anchors.slice(0, 20).map((row, i) => (
                      <tr key={`${i}-${row.anchor}`} className="border-b border-contour">
                        <td className="break-words py-2 pr-4">{row.anchor === "" ? "(no anchor text)" : row.anchor}</td>
                        <td className="py-2 pr-4">{count(row.backlinks)}</td>
                        <td className="py-2 pr-4">{count(row.referringDomains)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {competitor && (
            <section className="space-y-4" data-testid="seo-gap">
              <h2 className="text-lg font-semibold">Gap against {competitor}</h2>
              <p className="text-sm text-ridge">
                Links your competitor has that you don&apos;t, among each site&apos;s top 1,000 referring domains by rank.
              </p>
              {gap === null ? (
                <p className="text-ridge">No referring domains yet for both sites. Run a lookup for each.</p>
              ) : gap.length === 0 ? (
                <p className="text-ridge">No gap found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-contour text-ridge">
                        <th scope="col" className="py-2 pr-4 font-medium">Domain</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Rank</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Backlinks</th>
                        <th scope="col" className="py-2 pr-4 font-medium">First seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gap.slice(0, 100).map((row, i) => (
                        <tr key={`${i}-${row.domain}`} className="border-b border-contour">
                          <td className="break-all py-2 pr-4">{row.domain}</td>
                          <td className="py-2 pr-4">{count(row.rank)}</td>
                          <td className="py-2 pr-4">{count(row.backlinks)}</td>
                          <td className="py-2 pr-4">{day(row.firstSeen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </Shell>
  );
}
