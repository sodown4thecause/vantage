import { gateway } from "ai";

import { recordCost } from "@/lib/costs/ledger";
import { isPublicHttpUrl } from "@/lib/http/public-fetch";

export type TakoWebResult = { title: string; url: string; snippet: string };
export type TakoDataCard = { title: string; value: string; sourceUrl: string; sourceLabel?: string };
export type TakoResearchData = { web_results: TakoWebResult[]; cards: TakoDataCard[] };

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const asText = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const sourceUrl = (value: unknown): string | null => typeof value === "string" && isPublicHttpUrl(value) ? value : null;

/** The provider-executed search tool shipped by the AI SDK's Vercel Gateway integration. */
export function takoSearchTool() {
  // Fix the per-call price to the standard fast mode; provider config overrides model-supplied effort.
  return gateway.tools.takoSearch({ effort: "fast" });
}

function scalarSummary(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function valueOfCard(card: RecordValue): string {
  const content = isRecord(card.content) ? card.content : {};
  const cardData = isRecord(content.card_data) ? content.card_data : null;
  if (cardData) {
    const values = Object.entries(cardData).flatMap(([key, value]) => {
      const text = scalarSummary(value);
      return text ? [`${key}: ${text}`] : [];
    });
    if (values.length) return values.slice(0, 5).join(" · ").slice(0, 2000);
  }

  const dataset = isRecord(content.dataset) ? content.dataset : null;
  const columns = dataset && Array.isArray(dataset.columns) ? dataset.columns : [];
  const rows = dataset && Array.isArray(dataset.rows) ? dataset.rows : [];
  const firstRow = Array.isArray(rows[0]) ? rows[0] : null;
  if (firstRow && columns.length) {
    const values = firstRow.flatMap((value, index) => {
      const scalar = scalarSummary(value);
      if (!scalar) return [];
      const column = isRecord(columns[index]) ? columns[index] : {};
      const name = asText(column.name) || `Value ${index + 1}`;
      const unit = asText(column.unit);
      return [`${name}: ${scalar}${unit ? ` ${unit}` : ""}`];
    });
    if (values.length) return values.slice(0, 5).join(" · ").slice(0, 2000);
  }

  const records = Array.isArray(content.records) ? content.records : [];
  if (isRecord(records[0])) {
    const values = Object.entries(records[0] as RecordValue).flatMap(([key, value]) => {
      const text = scalarSummary(value);
      return text ? [`${key}: ${text}`] : [];
    });
    if (values.length) return values.slice(0, 5).join(" · ").slice(0, 2000);
  }
  return (asText(card.semantic_description) || asText(card.description) || asText(content.data)).slice(0, 2000);
}

/** Extract bounded, render-safe citations and data-card summaries from untrusted Tako output. */
export function normalizeTakoSearchOutput(output: unknown): TakoResearchData {
  if (!isRecord(output)) return { web_results: [], cards: [] };
  const web_results = (Array.isArray(output.web_results) ? output.web_results : []).flatMap((item) => {
    if (!isRecord(item)) return [];
    const title = asText(item.title);
    const url = sourceUrl(item.url);
    if (!title || !url) return [];
    return [{ title: title.slice(0, 500), url, snippet: asText(item.snippet).slice(0, 2000) }];
  }).slice(0, 20);

  const cards = (Array.isArray(output.cards) ? output.cards : []).flatMap((item) => {
    if (!isRecord(item)) return [];
    const title = asText(item.title) || "Research data";
    const sources = Array.isArray(item.sources) ? item.sources : [];
    const firstSource = sources.find((source) => isRecord(source) && sourceUrl(source.url));
    const url = sourceUrl(item.webpage_url) ?? (isRecord(firstSource) ? sourceUrl(firstSource.url) : null);
    const value = valueOfCard(item);
    if (!url || !value) return [];
    const label = isRecord(firstSource) ? asText(firstSource.source_name) : "";
    return [{ title: title.slice(0, 200), value, sourceUrl: url, ...(label ? { sourceLabel: label.slice(0, 120) } : {}) }];
  }).slice(0, 10);
  return { web_results, cards };
}

/** Tako calls are currently free; log every attempt at TAKO_SEARCH_USD (default 0) for cost visibility. */
export async function recordTakoSearchCost(workspaceId: string, sourceKey: "seo" | "gtm", output: unknown): Promise<void> {
  const rawPrice = process.env.TAKO_SEARCH_USD?.trim();
  const parsedPrice = rawPrice ? Number(rawPrice) : 0;
  const unitCostUsd = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;
  const failed = isRecord(output) && typeof output.error === "string";
  await recordCost({
    workspaceId,
    sourceKey,
    provider: "gateway",
    action: "tako_search",
    units: 1,
    unitCostUsd,
    ok: !failed,
  });
}

/** Count only web results: data cards do not replace the three source results required for Linkup fallback. */
export function takoWebResultCount(output: unknown): number {
  return normalizeTakoSearchOutput(output).web_results.length;
}

export function isTakoFilterRequest(input: unknown): boolean {
  if (!isRecord(input) || !isRecord(input.sources) || !isRecord(input.sources.web)) return false;
  const web = input.sources.web;
  return (Array.isArray(web.include_domains) && web.include_domains.length > 0)
    || typeof web.published_after === "string"
    || typeof web.published_before === "string";
}
