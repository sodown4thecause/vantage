import type { SourceCoverageView } from "@/lib/sources/list";

export function sourceCoverageSentence(source: SourceCoverageView): string {
  if (
    source.displayCoverage === "paused_global" ||
    source.health === "paused"
  ) {
    return "Reading from this source is paused.";
  }
  if (!source.collectorRegistered)
    return "Coming soon: reading from this source is not available yet.";
  switch (source.displayCoverage ?? source.coverage ?? source.health) {
    case "access_pending":
      return "Reading will start once access to this source is ready.";
    case "budget_limited":
      return "Reading is temporarily limited because the scan allowance has been reached.";
    case "blocked":
      return "This source is currently preventing us from reading conversations.";
    case "failed":
    case "failing":
      return "The latest scan could not finish; try scanning this source again.";
    case "degraded":
      return source.lastRun?.provider === "fixture"
        ? "Only sample conversations are available; live reading is not ready yet."
        : "The latest scan found only partial coverage of this source.";
    default:
      if (!source.lastRun)
        return "Ready to read conversations on the first scan.";
      return `The latest scan found ${source.lastRun.resultCount} ${source.lastRun.resultCount === 1 ? "conversation" : "conversations"}.`;
  }
}
