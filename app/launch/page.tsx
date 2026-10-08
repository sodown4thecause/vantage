import type { Metadata } from "next";
import Link from "next/link";

import { PageHead, Shell } from "@/components/shell";
import { humanize, isStale } from "@/lib/destinations/labels";
import { listDestinations } from "@/lib/destinations/repository";
import type { Destination } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Where to launch a developer tool | Vantage",
  description:
    "A hand-verified catalog of places to launch or list a developer tool: cost, requirements, link type and when each fact was last checked. Unknown stays unknown.",
  alternates: { canonical: "/launch" },
};

export default async function LaunchIndex() {
  let rows: Destination[] = [];
  let loadError = false;
  try {
    rows = await listDestinations();
  } catch (err) {
    console.error("[launch] failed to load destinations", { error: err instanceof Error ? err.name : "unknown" });
    loadError = true;
  }

  return (
    <Shell wide>
      <PageHead
        title="Where to launch a developer tool"
        lede="Each entry cites a primary source and the date we last checked it. Facts we could not verify say so instead of guessing."
      />
      {loadError ? (
        <p role="alert" className="text-ridge">
          The catalog could not be loaded right now. Try again in a minute.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-ridge" data-testid="launch-empty">
          No destinations have been verified yet. Check back soon.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="launch-list">
          {rows.map((row) => (
            <li key={row.slug} className="rounded-xl border border-contour p-4">
              <Link href={`/launch/${row.slug}`} className="text-lg font-semibold text-ink hover:underline">
                {row.name}
              </Link>
              <p className="mt-1 text-sm text-ridge">
                {humanize(row.kind)} · cost: {humanize(row.cost)} · links: {humanize(row.linkAttr)}
              </p>
              <p className="mt-2 text-xs text-ridge">
                Last verified {row.lastVerified}
                {isStale(row.lastVerified) ? " (stale, needs a re-check)" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
