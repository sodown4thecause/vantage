/**
 * Calibration report over semantic_shadow rows (mode "shadow") for one workspace.
 * Read-only. Run by a human: `DATABASE_URL=... pnpm tsx scripts/semantic-calibrate.ts <workspaceId>`.
 * Prints the agreement summary, fit percentiles and the 20 largest rung disagreements.
 * See docs/semantic-scoring.md for how to read the output.
 */
import { and, eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";

import { getDb } from "../lib/db/client";
import { document, semanticShadow } from "../lib/db/schema";

const DISAGREEMENT_LIMIT = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ShadowRow = {
  keywordRung: number;
  semanticRung: number | null;
  semanticFit: number | null;
  anchorSimilarity: number | null;
};

export type ShadowSummary = {
  total: number;
  agree: number;
  semanticHigher: number;
  semanticLower: number;
  noSemantic: number;
  fitP50: number;
  fitP90: number;
};

/**
 * Nearest-rank percentile: sort ascending and return the value at 1-based rank
 * ceil(p / 100 * n). No interpolation, so the result is always an observed value.
 * Returns 0 for an empty list.
 */
function nearestRank(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Compares the keyword rung with the semantic rung. A null semantic rung counts as
 * noSemantic (the anchor was below threshold or no signal existed). Fit percentiles
 * use every non-null fit, including rows whose rung is null.
 */
export function summarizeShadow(rows: ShadowRow[]): ShadowSummary {
  let agree = 0;
  let semanticHigher = 0;
  let semanticLower = 0;
  let noSemantic = 0;
  const fits: number[] = [];

  for (const row of rows) {
    if (row.semanticFit !== null) fits.push(row.semanticFit);
    if (row.semanticRung === null) {
      noSemantic += 1;
    } else if (row.semanticRung === row.keywordRung) {
      agree += 1;
    } else if (row.semanticRung > row.keywordRung) {
      semanticHigher += 1;
    } else {
      semanticLower += 1;
    }
  }

  return {
    total: rows.length,
    agree,
    semanticHigher,
    semanticLower,
    noSemantic,
    fitP50: nearestRank(fits, 50),
    fitP90: nearestRank(fits, 90),
  };
}

/**
 * Rows where both rungs exist and differ, largest absolute gap first. Ties are
 * broken by title so repeated runs print the same order.
 */
export function largestDisagreements<T extends ShadowRow & { title: string | null }>(
  rows: T[],
  limit = DISAGREEMENT_LIMIT,
): T[] {
  const gap = (row: T) => Math.abs((row.semanticRung ?? row.keywordRung) - row.keywordRung);
  return rows
    .filter((row) => row.semanticRung !== null && row.semanticRung !== row.keywordRung)
    .sort((a, b) => gap(b) - gap(a) || (a.title ?? "").localeCompare(b.title ?? ""))
    .slice(0, limit);
}

async function loadShadowRows(workspaceId: string) {
  return getDb()
    .select({
      title: document.title,
      keywordRung: semanticShadow.keywordRung,
      semanticRung: semanticShadow.semanticRung,
      semanticFit: semanticShadow.semanticFit,
      anchorSimilarity: semanticShadow.anchorSimilarity,
    })
    .from(semanticShadow)
    .innerJoin(document, eq(semanticShadow.documentId, document.id))
    .where(and(eq(semanticShadow.workspaceId, workspaceId), eq(semanticShadow.mode, "shadow")));
}

async function main() {
  const workspaceId = process.argv[2]?.trim() ?? "";
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error("usage: DATABASE_URL=... pnpm tsx scripts/semantic-calibrate.ts <workspaceId>");
  }

  const rows = await loadShadowRows(workspaceId);
  const summary = summarizeShadow(rows);
  console.log(`semantic_shadow rows (mode shadow) for workspace ${workspaceId}: ${summary.total}`);
  console.log(
    `agree ${summary.agree}  semanticHigher ${summary.semanticHigher}  ` +
      `semanticLower ${summary.semanticLower}  noSemantic ${summary.noSemantic}`,
  );
  console.log(`semantic fit p50 ${summary.fitP50}  p90 ${summary.fitP90}`);

  const disagreements = largestDisagreements(rows);
  console.log(`\n${disagreements.length} largest disagreements (keyword rung -> semantic rung):`);
  for (const row of disagreements) {
    // JSON.stringify escapes control and ANSI/OSC sequences from external titles before they reach the terminal.
    console.log(`  ${row.keywordRung} -> ${row.semanticRung}  ${JSON.stringify(row.title ?? "(untitled)")}`);
  }
}

// Import (for tests) must not run the CLI; only direct execution does.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
