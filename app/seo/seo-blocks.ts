import { parseBlocks, type Block } from "@/lib/workspace/blocks";
import { linkupPageBlocks, linkupResearchBlocks, takoResearchBlocks } from "@/lib/research/blocks";

/*
 * Turns SEO result cards (provider output, untrusted) into table and chart blocks. Client-safe: no server imports.
 * Only the backlink and ranking cards map; other cards keep their own renderer.
 */

type Card = { tool: string; title: string; data: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const rowsOf = (data: unknown): Record<string, unknown>[] => (Array.isArray(data) ? data.filter(isRecord) : []);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.slice(0, 500) : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Referring domains first seen per month, as a running total. */
export function referringDomainsOverTime(rows: Record<string, unknown>[]): { label: string; value: number }[] {
  const perMonth = new Map<string, number>();
  for (const row of rows) {
    const month = str(row.firstSeen)?.match(/^\d{4}-\d{2}/)?.[0];
    if (month) perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
  }
  let total = 0;
  return [...perMonth.keys()].sort().slice(-60).map((label) => ({ label, value: (total += perMonth.get(label)!) }));
}

const POSITION_BUCKETS: [string, number, number][] = [["1–3", 1, 3], ["4–10", 4, 10], ["11–20", 11, 20], ["21–50", 21, 50], ["51–100", 51, 100]];

/** How many keywords rank in each position band. */
export function rankingDistribution(rows: Record<string, unknown>[]): { label: string; value: number }[] {
  return POSITION_BUCKETS.map(([label, min, max]) => ({
    label,
    value: rows.filter((row) => {
      const position = num(row.position);
      return position !== null && position >= min && position <= max;
    }).length,
  }));
}

export function seoCardBlocks(card: Card): Block[] {
  if (card.tool === "tako_search") return takoResearchBlocks(card.data);
  if (card.tool === "web_research") return linkupResearchBlocks(card.data);
  if (card.tool === "linkup_fetch") return linkupPageBlocks(card.data);
  const title = card.title.trim().slice(0, 200) || "SEO results";
  if (card.tool === "backlink_summary" && isRecord(card.data)) {
    const data = card.data;
    return parseBlocks([{
      type: "table", title, columns: ["Metric", "Value"],
      rows: [
        ["Domain rank", num(data.rank)], ["Backlinks", num(data.backlinks)], ["Referring domains", num(data.referringDomains)],
        ["Broken backlinks", num(data.brokenBacklinks)], ["Spam score", num(data.spamScore)],
      ],
    }]);
  }
  if (card.tool === "referring_domains") {
    const rows = rowsOf(card.data).slice(0, 100);
    if (!rows.length) return [];
    const overTime = referringDomainsOverTime(rows);
    return parseBlocks([
      { type: "table", title, columns: ["Domain", "Rank", "Backlinks", "First seen"],
        rows: rows.map((row) => [str(row.domain), num(row.rank), num(row.backlinks), str(row.firstSeen)?.slice(0, 10) ?? null]) },
      ...(overTime.length > 1 ? [{ type: "chart", kind: "line", title: "Referring domains over time", xLabel: "Month first seen", yLabel: "Referring domains", points: overTime }] : []),
    ]);
  }
  if (card.tool === "ranked_keywords" || card.tool === "keyword_gap") {
    const rows = rowsOf(card.data).slice(0, 100);
    if (!rows.length) return [];
    return parseBlocks([
      { type: "table", title, columns: ["Keyword", "Position", "Volume", "Difficulty", "URL"],
        rows: rows.map((row) => [str(row.keyword), num(row.position), num(row.searchVolume), num(row.difficulty), str(row.url)]) },
      { type: "chart", kind: "bar", title: "Keywords by ranking position", xLabel: "Position", yLabel: "Keywords", points: rankingDistribution(rows) },
    ]);
  }
  return [];
}
