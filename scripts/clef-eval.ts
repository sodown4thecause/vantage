/**
 * Clef shadow evaluation over the growth-wiki eval set.
 *
 *   pnpm tsx scripts/clef-eval.ts <eval-set.csv> [--sheet <out.csv>]
 *
 * Prints precision@5, agreement and cost per 1,000 posts for the current
 * deterministic scorer beside Clef. Refuses to print a result until at least 30
 * rows carry human labels: model guesses are not truth.
 */
import { readFileSync, writeFileSync } from "node:fs";

import type { AiBinding } from "@/lib/cf/env";
import { computeFeatures, scoreFeatures } from "@/lib/opportunities/features";
import type { NormalizedDocument } from "@/lib/pipeline/normalize";
import { askClef } from "@/lib/decisions/clef";
import { rankingQuestions, rankingState } from "@/lib/decisions/shadow";

const MIN_LABELLED = 30;
const TOP_N = 5;
const LABEL_COLUMNS = ["expertise_label", "gap_label", "stakes_label", "fit_label"] as const;

/**
 * A CLI process has no Cloudflare request context, so the Worker's AI binding is
 * absent. This calls the same Workers AI REST endpoint the binding wraps.
 */
function restAi(accountId: string, token: string): AiBinding {
  return {
    async run(model, input) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) throw new Error(`Workers AI returned HTTP ${response.status}`);
      const body = await response.json() as { result?: unknown; success?: boolean };
      if (body.success === false || body.result === undefined) throw new Error("Workers AI returned no result");
      return body.result;
    },
  };
}

type Row = Record<string, string>;

/** Minimal CSV reader: quoted fields, escaped quotes, CRLF. */
function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
  if (!header) return [];
  return body.map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), (cells[index] ?? "").trim()])));
}

function textOf(row: Row): string {
  const title = row.title ?? row.thread_title ?? "";
  const body = row.body ?? row.text ?? row.thread_text ?? row.content ?? "";
  return `${title}\n\n${body}`.trim();
}

function isLabelled(row: Row): boolean {
  return LABEL_COLUMNS.some((column) => (row[column] ?? "").trim() !== "");
}

/** A human "worth joining" verdict from whichever labels are present. */
function humanPositive(row: Row): boolean | null {
  const fit = (row.fit_label ?? "").toLowerCase();
  if (fit) return !["not_fit", "no", "false", "0", "none"].includes(fit);
  const gap = (row.gap_label ?? "").toLowerCase();
  if (gap) return ["open", "unanswered", "bad", "yes", "true", "1"].includes(gap);
  return null;
}

function asDocument(row: Row, index: number): NormalizedDocument {
  return {
    id: `eval-${index}`,
    workspaceId: "eval",
    platform: row.platform ?? "reddit",
    title: row.title ?? row.thread_title ?? "",
    authorRef: null,
    text: textOf(row),
    contentHash: `eval-${index}`,
    urlCanonical: row.url ?? `https://example.invalid/eval/${index}`,
    postedAt: null,
  };
}

function topN<T>(items: T[], score: (item: T) => number): Set<T> {
  return new Set([...items].sort((a, b) => score(b) - score(a)).slice(0, TOP_N));
}

function precisionAt5(rows: Row[], chosen: Set<Row>): number {
  const labelled = [...chosen].filter((row) => humanPositive(row) !== null);
  if (!labelled.length) return 0;
  return labelled.filter((row) => humanPositive(row) === true).length / labelled.length;
}

function sheet(rows: Row[]): string {
  const header = ["row", "platform", "title", "url", "excerpt", ...LABEL_COLUMNS];
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = [header.join(",")];
  rows.forEach((row, index) => {
    lines.push([
      String(index + 1),
      row.platform ?? "",
      row.title ?? row.thread_title ?? "",
      row.url ?? "",
      textOf(row).slice(0, 400),
      ...LABEL_COLUMNS.map((column) => row[column] ?? ""),
    ].map(escape).join(","));
  });
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith("--"));
  const sheetIndex = args.indexOf("--sheet");
  const sheetPath = sheetIndex >= 0 ? args[sheetIndex + 1] : null;
  if (!path) {
    console.error("Usage: pnpm tsx scripts/clef-eval.ts <eval-set.csv> [--sheet <out.csv>]");
    process.exit(2);
  }
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (!rows.length) {
    console.error(`No rows found in ${path}`);
    process.exit(2);
  }
  const labelled = rows.filter(isLabelled);
  console.log(`Rows: ${rows.length}. Labelled: ${labelled.length}.`);

  if (sheetPath) {
    writeFileSync(sheetPath, sheet(rows));
    console.log(`Labelling sheet written to ${sheetPath}`);
  }

  if (labelled.length < MIN_LABELLED) {
    console.log(
      `\nSTOP: ${labelled.length} of ${rows.length} rows carry human labels; ${MIN_LABELLED} are needed.`
      + "\nNo precision, agreement or cost result is reported without human labels."
      + (sheetPath ? "" : "\nRe-run with --sheet <out.csv> to write the labelling sheet."),
    );
    return;
  }

  const workspaceId = process.env.CLEF_EVAL_WORKSPACE_ID?.trim();
  if (!workspaceId) {
    console.error("CLEF_EVAL_WORKSPACE_ID is required: paid calls need workspace attribution.");
    process.exit(2);
  }
  const profile = process.env.CLEF_EVAL_PROFILE?.trim() || "No workspace profile is saved.";
  const segments = (process.env.CLEF_EVAL_SEGMENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const accountId = process.env.CF_AIG_ACCOUNT_ID?.trim();
  const token = process.env.CF_AIG_TOKEN?.trim();
  if (!accountId || !token) {
    console.error("CF_AIG_ACCOUNT_ID and CF_AIG_TOKEN are required to call Clef from the CLI.");
    process.exit(2);
  }
  const ai = restAi(accountId, token);
  const baselineProfile = { productDescription: profile, topics: segments, competitors: [] };

  const current = new Map<Row, number>();
  for (const [index, row] of rows.entries()) {
    current.set(row, scoreFeatures(computeFeatures([asDocument(row, index)], baselineProfile)));
  }

  const clef = new Map<Row, number>();
  let tokens = 0;
  for (const row of rows) {
    const state = rankingState({ thread: textOf(row), profileSummary: profile });
    const result = await askClef({
      workspaceId,
      sourceKey: "eval",
      action: "clef_eval",
      variant: "clef",
      state,
      questions: rankingQuestions(segments),
      ai,
    });
    if (!result) { console.error("Clef call failed; aborting the comparison."); process.exit(1); }
    tokens += result.inputTokens;
    const fit = result.answers.fit;
    const gap = result.answers.answer_gap;
    const fitProbability = fit?.type === "choice"
      ? 1 - (fit.probabilities.not_fit ?? 0)
      : 0;
    const gapProbability = gap?.type === "noul" ? gap.noul : 0;
    clef.set(row, fitProbability * gapProbability);
  }

  const currentTop = topN(rows, (row) => current.get(row) ?? 0);
  const clefTop = topN(rows, (row) => clef.get(row) ?? 0);
  const agreement = rows.filter((row) => currentTop.has(row) === clefTop.has(row)).length / rows.length;
  const costPerThousand = (tokens / rows.length) * 1_000 * (0.24 / 1_000_000);

  console.log(`\nprecision@${TOP_N}  current ${precisionAt5(rows, currentTop).toFixed(3)}  clef ${precisionAt5(rows, clefTop).toFixed(3)}`);
  console.log(`agreement       ${agreement.toFixed(3)}`);
  console.log(`cost/1,000      $${costPerThousand.toFixed(4)}`);
}

await main();
