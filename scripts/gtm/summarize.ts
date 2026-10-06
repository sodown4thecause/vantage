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

const yes = (value: string) => /^(y|yes|true|1)$/i.test(value.trim());

function num(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseRescueCsv(text: string): RescueRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const col = (name: string) => header.map((h) => h.trim().toLowerCase()).indexOf(name);
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
  if (idx.id < 0 || idx.rescuedOn < 0) {
    throw new Error("CSV must include at least the id and rescued_on columns");
  }
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
  return body.map((row) => ({
    id: get(row, idx.id),
    sourceTool: get(row, idx.sourceTool),
    contactedOn: get(row, idx.contactedOn),
    rescuedOn: get(row, idx.rescuedOn),
    activated: yes(get(row, idx.activated)),
    paying: yes(get(row, idx.paying)),
    founderMinutes: num(get(row, idx.founderMinutes)),
    providerCostUsd: num(get(row, idx.providerCostUsd)),
  }));
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
  console.log(formatSummary(summarize(parseRescueCsv(readFileSync(path, "utf8")))));
}
