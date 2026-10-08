import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SafeLink } from "@/components/safe-link";
import { PageHead, Shell } from "@/components/shell";
import { humanize, isStale, requirementLines } from "@/lib/destinations/labels";
import { getDestinationBySlug } from "@/lib/destinations/repository";
import type { Destination } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string): Promise<{ row: Destination | null; failed: boolean }> {
  try {
    return { row: await getDestinationBySlug(slug), failed: false };
  } catch (err) {
    console.error("[launch/slug] failed to load destination", { error: err instanceof Error ? err.name : "unknown" });
    return { row: null, failed: true };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { row } = await load(slug);
  if (!row) return { title: "Launch destination | Vantage", robots: { index: false } };
  return {
    title: `Is ${row.name} worth it for a developer tool? | Vantage`,
    description: `${row.name}: cost ${humanize(row.cost)}, listing mode ${humanize(row.listingMode)}, link type ${humanize(row.linkAttr)}. Last verified ${row.lastVerified}.`,
    alternates: { canonical: `/launch/${row.slug}` },
  };
}

export default async function LaunchDestination({ params }: Props) {
  const { slug } = await params;
  const { row, failed } = await load(slug);

  if (failed) {
    return (
      <Shell>
        <p role="alert" className="text-ridge">
          This entry could not be loaded right now. Try again in a minute.
        </p>
      </Shell>
    );
  }
  if (!row) notFound();

  const requirements = requirementLines(row.requirements);
  const facts: [string, string][] = [
    ["Type", humanize(row.kind)],
    ["Cost", humanize(row.cost) + (row.priceNote ? ` (${row.priceNote})` : "")],
    ["Listing mode", humanize(row.listingMode)],
    ["Submissions open", humanize(row.submissionsOpen)],
    ["Link type", humanize(row.linkAttr)],
    ["Cited by AI answer engines", humanize(row.aiCited)],
  ];

  return (
    <Shell>
      <p className="mb-4 text-sm">
        <Link href="/launch" className="text-ridge hover:text-ink">
          All destinations
        </Link>
      </p>
      <PageHead title={`Is ${row.name} worth it for a developer tool?`} />
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2" data-testid="facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-ridge">{label}</dt>
            <dd className="text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {row.aiCited === "yes" && row.aiCitedEvidence && (
        <p className="mt-4 text-sm text-ridge">AI citation evidence: {row.aiCitedEvidence}</p>
      )}
      {requirements.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">Requirements</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ridge">
            {requirements.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {row.notes && <p className="mt-6 text-ridge">{row.notes}</p>}
      <section className="mt-8 space-y-1 text-sm text-ridge">
        <p>
          <SafeLink href={row.url} className="underline">
            Visit {row.name}
          </SafeLink>
          {row.submissionUrl && (
            <>
              {" · "}
              <SafeLink href={row.submissionUrl} className="underline">
                Submission page
              </SafeLink>
            </>
          )}
        </p>
        <p>
          Source:{" "}
          <SafeLink href={row.sourceUrl} className="underline">
            {row.sourceUrl}
          </SafeLink>
          . Last verified {row.lastVerified}
          {isStale(row.lastVerified) ? " (stale, needs a re-check)" : ""}.
        </p>
        <p>Vantage never submits anything for you; you submit on the destination yourself.</p>
      </section>
    </Shell>
  );
}
