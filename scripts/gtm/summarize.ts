import { readFileSync } from "node:fs";

export type RescueRow = {
  id: string;
  sourceTool: string;
  contactedOn: string;
  rescuedOn: string;
  activated: boolean;
  paying: boolean;
  founderMinutes: number;
  providerCostUsd: number;
};

export type GateStatus = {
  contacted: number;
  rescues: number;
  activations: number;
  paying: number;
  founderMinutes: number;
  providerCostUsd: number;
  founderMinutesPerRescue: number | null;
  costPerRescueUsd: number | null;
  gates: { rescues: boolean; activations: boolean; paying: boolean };
  passed: boolean;
};

export const GATES = { rescues: 3, activations: 2, paying: 2 } as const;

/** Minimal RFC 4180 style CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseYesNo(value: string, field: string, rowLabel: string, problems: string[]): boolean {
  const v = value.trim().toLowerCase();
  if (v === "" || v === "no" || v === "n" || v === "false" || v === "0") return false;
  if (v === "yes" || v === "y" || v === "true" || v === "1") return true;
  problems.push(`${rowLabel}: ${field} must be yes or no (got "${value.trim()}")`);
  return false;
}

function parseNumber(value: string, field: string, rowLabel: string, problems: string[]): number {
  const v = value.trim();
  if (v === "") return 0;
  const parsed = Number(v);
  if (!Number.isFinite(parsed) || parsed < 0) {
    problems.push(`${rowLabel}: ${field} must be a non-negative number (got "${v}")`);
    return 0;
  }
  return parsed;
}

const REQUIRED_COLUMNS = ["id", "rescued_on", "activated", "paying"] as const;

/**
 * Parse the tracking sheet. Anything ambiguous is rejected with every problem
 * listed at once, because a silently wrong gate decision is worse than an error.
 */
export function parseRescueCsv(text: string): RescueRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const names = header.map((h) => h.trim().toLowerCase());
  const col = (name: string) => names.indexOf(name);
  const missing = REQUIRED_COLUMNS.filter((name) => col(name) < 0);
  if (missing.length) {
    throw new Error(`CSV is missing required column(s): ${missing.join(", ")}`);
  }
  const idx = {
    id: col("id"),
    sourceTool: col("source_tool"),
    contactedOn: col("contacted_on"),
    rescuedOn: col("rescued_on"),
    activated: col("activated"),
    paying: col("paying"),
    founderMinutes: col("founder_minutes"),
    providerCostUsd: col("provider_cost_usd"),
  };
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
  const problems: string[] = [];
  const seen = new Set<string>();
  const rows: RescueRow[] = body.map((row, n) => {
    const id = get(row, idx.id);
    const label = id ? `row ${n + 2} (${id})` : `row ${n + 2}`;
    if (!id) problems.push(`${label}: id is empty`);
    else if (seen.has(id.toLowerCase())) problems.push(`${label}: duplicate id`);
    seen.add(id.toLowerCase());
    const rescuedOn = get(row, idx.rescuedOn);
    if (rescuedOn !== "" && !ISO_DATE.test(rescuedOn)) {
      problems.push(`${label}: rescued_on must be YYYY-MM-DD or blank (got "${rescuedOn}")`);
    }
    return {
      id,
      sourceTool: get(row, idx.sourceTool),
      contactedOn: get(row, idx.contactedOn),
      rescuedOn: ISO_DATE.test(rescuedOn) ? rescuedOn : "",
      activated: parseYesNo(get(row, idx.activated), "activated", label, problems),
      paying: parseYesNo(get(row, idx.paying), "paying", label, problems),
      founderMinutes: parseNumber(get(row, idx.founderMinutes), "founder_minutes", label, problems),
      providerCostUsd: parseNumber(get(row, idx.providerCostUsd), "provider_cost_usd", label, problems),
    };
  });
  if (problems.length) {
    throw new Error(`Tracking sheet has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  }
  return rows;
}

export function summarize(rows: RescueRow[]): GateStatus {
  const rescued = rows.filter((row) => row.rescuedOn !== "");
  const rescues = rescued.length;
  const activations = rows.filter((row) => row.activated && row.rescuedOn !== "").length;
  const paying = rows.filter((row) => row.paying && row.rescuedOn !== "").length;
  const founderMinutes = rows.reduce((sum, row) => sum + row.founderMinutes, 0);
  const providerCostUsd = Math.round(rows.reduce((sum, row) => sum + row.providerCostUsd, 0) * 1e6) / 1e6;
  const gates = {
    rescues: rescues >= GATES.rescues,
    activations: activations >= GATES.activations,
    paying: paying >= GATES.paying,
  };
  return {
    contacted: rows.filter((row) => row.contactedOn !== "" || row.rescuedOn !== "").length,
    rescues,
    activations,
    paying,
    founderMinutes,
    providerCostUsd,
    founderMinutesPerRescue: rescues ? Math.round(founderMinutes / rescues) : null,
    costPerRescueUsd: rescues ? Math.round((providerCostUsd / rescues) * 1e6) / 1e6 : null,
    gates,
    passed: gates.rescues && gates.activations && gates.paying,
  };
}

export function formatSummary(status: GateStatus): string {
  const mark = (ok: boolean) => (ok ? "PASS" : "not yet");
  return [
    `Contacted: ${status.contacted}`,
    `Completed rescues: ${status.rescues} / ${GATES.rescues}  [${mark(status.gates.rescues)}]`,
    `Activations:       ${status.activations} / ${GATES.activations}  [${mark(status.gates.activations)}]`,
    `Founders paying:   ${status.paying} / ${GATES.paying}  [${mark(status.gates.paying)}]`,
    `Founder time: ${status.founderMinutes} min` +
      (status.founderMinutesPerRescue === null ? "" : ` (${status.founderMinutesPerRescue} min per rescue)`),
    `Provider cost: $${status.providerCostUsd.toFixed(2)}` +
      (status.costPerRescueUsd === null ? "" : ` ($${status.costPerRescueUsd.toFixed(2)} per rescue)`),
    status.passed ? "ALL GATES PASSED" : "Gates not all met",
  ].join("\n");
}

if (process.argv[1] && /summarize\.[mc]?[tj]s$/.test(process.argv[1])) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: pnpm tsx scripts/gtm/summarize.ts <tracking.csv>");
    process.exit(2);
  }
  try {
    console.log(formatSummary(summarize(parseRescueCsv(readFileSync(path, "utf8")))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
