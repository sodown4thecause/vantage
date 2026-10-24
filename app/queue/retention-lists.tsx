import Link from "next/link";

import { MarkOutcome } from "@/components/mark-outcome";
import { HANDOFF_STATE_LABEL, recapLine, type MonthlyRecap } from "@/lib/retention/handoff-state";
import type { MarkedReply } from "@/lib/retention/outcomes";
import { previousDay } from "@/lib/retention/days";
import type { EarlierPick } from "@/lib/retention/picks";

function formatDay(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone }).format(at);
}

function href(workspaceId: string, opportunityId: string) {
  return `/opportunities/${opportunityId}?workspaceId=${encodeURIComponent(workspaceId)}`;
}

export function RetentionLists({
  workspaceId,
  today,
  timeZone,
  earlier,
  marked,
  recap,
}: {
  workspaceId: string;
  today: string;
  timeZone: string;
  earlier: { day: string; picks: EarlierPick[] } | null;
  marked: MarkedReply[];
  recap: MonthlyRecap;
}) {
  const recapText = recapLine(recap);
  if (!earlier && marked.length === 0 && !recapText) return null;
  const isYesterday = earlier?.day === previousDay(today);

  return (
    <div className="mt-12 space-y-8 border-t border-contour pt-8" data-testid="queue-retention">
      {recapText ? <p className="text-ridge" data-testid="queue-recap">{recapText}</p> : null}

      {earlier ? (
        <details className="group" data-testid="queue-earlier">
          <summary className="cursor-pointer text-xl font-semibold tracking-tight">
            {isYesterday ? "Yesterday's five" : `Your picks from ${formatDay(new Date(`${earlier.day}T12:00:00Z`), "UTC")}`}
          </summary>
          <p className="mt-2 max-w-[62ch] text-sm text-ridge">
            Mark what you did yourself. Vantage cannot see Reddit or Hacker News, so these marks are only what you tell it.
          </p>
          <ul className="mt-4 divide-y divide-contour border-y border-contour">
            {earlier.picks.map((pick) => (
              <li key={pick.opportunityId} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
                <div className="min-w-0 space-y-1">
                  <Link href={href(workspaceId, pick.opportunityId)} className="link font-semibold leading-snug">{pick.title}</Link>
                  {pick.state ? <p className="text-sm text-ridge">{HANDOFF_STATE_LABEL[pick.state]}</p> : null}
                </div>
                <MarkOutcome workspaceId={workspaceId} opportunityId={pick.opportunityId} state={pick.state} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {marked.length > 0 ? (
        <section aria-labelledby="marked-heading" data-testid="queue-marked">
          <h2 id="marked-heading" className="text-xl font-semibold tracking-tight">Sent and replied</h2>
          <ul className="mt-4 divide-y divide-contour border-y border-contour">
            {marked.map((item) => (
              <li key={item.opportunityId} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                <Link href={href(workspaceId, item.opportunityId)} className="link min-w-0 font-semibold leading-snug">{item.title}</Link>
                <p className="text-sm text-ridge">
                  {HANDOFF_STATE_LABEL[item.state]}, {formatDay(new Date(item.markedAt), timeZone)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
