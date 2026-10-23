import { parseBlocks, type Block } from "@/lib/workspace/blocks";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Tako's curated data cards and web results as safe, saveable visual cards. */
export function takoResearchBlocks(value: unknown): Block[] {
  if (!isRecord(value)) return [];
  const blocks: unknown[] = [];
  for (const item of Array.isArray(value.cards) ? value.cards : []) {
    if (!isRecord(item)) continue;
    blocks.push({
      type: "research_card",
      title: text(item.title, 200),
      value: text(item.value, 2000),
      sourceUrl: text(item.sourceUrl, 2000),
      ...(text(item.sourceLabel, 120) ? { sourceLabel: text(item.sourceLabel, 120) } : {}),
    });
  }
  for (const item of Array.isArray(value.web_results) ? value.web_results : []) {
    if (!isRecord(item)) continue;
    blocks.push({
      type: "research_card",
      title: text(item.title, 200),
      value: text(item.snippet, 2000) || "Open the source for the research excerpt.",
      sourceUrl: text(item.url, 2000),
      sourceLabel: "Open source ↗",
    });
  }
  return parseBlocks(blocks.slice(0, 12));
}

/** Linkup search result citations as the same saveable workspace visual. */
export function linkupResearchBlocks(value: unknown): Block[] {
  if (!isRecord(value)) return [];
  const blocks = (Array.isArray(value.results) ? value.results : []).flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      type: "research_card",
      title: text(item.title, 200),
      value: text(item.snippet, 2000) || "Open the source for the research excerpt.",
      sourceUrl: text(item.url, 2000),
      sourceLabel: "Open source ↗",
    }];
  });
  return parseBlocks(blocks.slice(0, 12));
}

/** The fetched page's opening passage stays grounded by its validated source URL. */
export function linkupPageBlocks(value: unknown): Block[] {
  if (!isRecord(value)) return [];
  const url = text(value.url, 2000);
  const markdown = text(value.markdown, 2000);
  if (!url || !markdown) return [];
  let title = "Fetched page";
  try { title = new URL(url).hostname; } catch { /* parseBlocks rejects invalid URLs below */ }
  return parseBlocks([{
    type: "research_card",
    title: `Page research — ${title}`.slice(0, 200),
    value: markdown,
    sourceUrl: url,
    sourceLabel: "Read original page ↗",
  }]);
}
