import type { NewDocument } from "@/lib/db/schema";

/** Operator-facing coverage labels (Settings → Sources & Coverage). */
export const COVERAGE_STATUSES = [
  "healthy",
  "degraded",
  "access_pending",
  "budget_limited",
  "blocked",
  "failed",
] as const;

export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

/** Values persisted on source.health (includes legacy failing/paused). */
export type SourceHealthValue =
  | CoverageStatus
  | "failing"
  | "paused";

export type SourceRunReceipt = {
  coverage: CoverageStatus;
  health: SourceHealthValue;
  reason: string;
  inserted: number;
  skipped: number;
  resultCount: number;
  provider: string | null;
  ranAt: string;
};

const ACCESS_RE =
  /access[_\s-]?pending|missing\b|api[_\s-]?key|unauthorized|401|403|forbidden|not configured|no\b.+\bkey/i;
const BUDGET_RE =
  /budget|rate.?limit|429|quota|throttl|resource.?exhausted/i;
const BLOCKED_RE = /blocked|captcha|cloudflare|permission denied|451/i;

export function providerFromDocuments(
  documents: Array<Pick<NewDocument, "metadata">>,
): string | null {
  for (const doc of documents) {
    const provider = doc.metadata?.provider;
    if (typeof provider === "string" && provider.trim()) {
      return provider.trim();
    }
  }
  return null;
}

export function documentsAreFixtureOnly(
  documents: Array<Pick<NewDocument, "metadata">>,
): boolean {
  if (!documents.length) return false;
  return documents.every((doc) => {
    const provider = doc.metadata?.provider;
    const mocked = doc.metadata?.mocked;
    return provider === "fixture" || mocked === true;
  });
}

/**
 * Classify coverage for a successful or failed collector run.
 * Fixture-only success is degraded (not healthy) so Settings never claims
 * live coverage when keys are missing.
 */
export function classifyCollectorCoverage(input: {
  documents: Array<Pick<NewDocument, "metadata">>;
  inserted: number;
  skipped: number;
  error?: string | null;
}): Omit<SourceRunReceipt, "ranAt"> {
  const resultCount = input.documents.length;
  const provider = providerFromDocuments(input.documents);

  if (input.error) {
    const message = input.error;
    if (ACCESS_RE.test(message)) {
      return {
        coverage: "access_pending",
        health: "access_pending",
        reason: message,
        inserted: input.inserted,
        skipped: input.skipped,
        resultCount,
        provider,
      };
    }
    if (BUDGET_RE.test(message)) {
      return {
        coverage: "budget_limited",
        health: "budget_limited",
        reason: message,
        inserted: input.inserted,
        skipped: input.skipped,
        resultCount,
        provider,
      };
    }
    if (BLOCKED_RE.test(message)) {
      return {
        coverage: "blocked",
        health: "blocked",
        reason: message,
        inserted: input.inserted,
        skipped: input.skipped,
        resultCount,
        provider,
      };
    }
    return {
      coverage: "failed",
      health: "failed",
      reason: message,
      inserted: input.inserted,
      skipped: input.skipped,
      resultCount,
      provider,
    };
  }

  if (documentsAreFixtureOnly(input.documents)) {
    return {
      coverage: "degraded",
      health: "degraded",
      reason:
        "Fixture provider used — live credentials missing or scrape lane unavailable.",
      inserted: input.inserted,
      skipped: input.skipped,
      resultCount,
      provider: provider ?? "fixture",
    };
  }

  if (resultCount === 0) {
    return {
      coverage: "healthy",
      health: "healthy",
      reason: "Scan completed with no new documents (empty or not-modified).",
      inserted: input.inserted,
      skipped: input.skipped,
      resultCount,
      provider,
    };
  }

  return {
    coverage: "healthy",
    health: "healthy",
    reason: `Scan completed (${input.inserted} inserted, ${input.skipped} skipped).`,
    inserted: input.inserted,
    skipped: input.skipped,
    resultCount,
    provider,
  };
}

export function readLastRunReceipt(
  config: Record<string, unknown> | null | undefined,
): SourceRunReceipt | null {
  const raw = config?.lastRun;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const coverage = o.coverage;
  if (
    typeof coverage !== "string" ||
    !(COVERAGE_STATUSES as readonly string[]).includes(coverage)
  ) {
    return null;
  }
  return {
    coverage: coverage as CoverageStatus,
    health:
      typeof o.health === "string"
        ? (o.health as SourceHealthValue)
        : (coverage as SourceHealthValue),
    reason: typeof o.reason === "string" ? o.reason : "",
    inserted: Number(o.inserted ?? 0) || 0,
    skipped: Number(o.skipped ?? 0) || 0,
    resultCount: Number(o.resultCount ?? 0) || 0,
    provider: typeof o.provider === "string" ? o.provider : null,
    ranAt: typeof o.ranAt === "string" ? o.ranAt : "",
  };
}

export function withLastRunReceipt(
  config: Record<string, unknown> | null | undefined,
  receipt: SourceRunReceipt,
): Record<string, unknown> {
  return {
    ...(config ?? {}),
    lastRun: receipt,
  };
}
