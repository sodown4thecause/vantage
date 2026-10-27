/** Deterministic projections that keep model context free of raw provider dumps. */

import { isPublicHttpUrl } from "@/lib/http/public-fetch";

export const MODEL_ROW_LIMIT = 25;
export const MODEL_STRING_LIMIT = 4_000;
/** Max JSON size for one tool result returned to a model. */
export const MODEL_PAYLOAD_JSON_LIMIT = 12_000;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function clipString(value: string, limit = MODEL_STRING_LIMIT): { value: string; truncated: boolean } {
  if (value.length <= limit) return { value, truncated: false };
  return { value: value.slice(0, limit), truncated: true };
}

function pickString(record: Record<string, unknown>, key: string): string | null {
  const value = asString(record[key]);
  return value === null ? null : clipString(value).value;
}

function pickNumber(record: Record<string, unknown>, key: string): number | null {
  return asNumber(record[key]);
}

function pickBoolean(record: Record<string, unknown>, key: string): boolean | null {
  return asBoolean(record[key]);
}

function boundValue(value: unknown, state: { truncated: boolean }): Json {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    const clipped = clipString(value);
    if (clipped.truncated) state.truncated = true;
    return clipped.value;
  }
  if (Array.isArray(value)) {
    if (value.length > MODEL_ROW_LIMIT) state.truncated = true;
    return value.slice(0, MODEL_ROW_LIMIT).map((item) => boundValue(item, state));
  }
  if (isRecord(value)) {
    const out: Record<string, Json> = {};
    for (const [key, nested] of Object.entries(value)) out[key] = boundValue(nested, state);
    return out;
  }
  state.truncated = true;
  return null;
}

function listResult(
  rows: unknown[],
  projectRow: (row: Record<string, unknown>) => Record<string, Json> | null,
): { rows: Array<Record<string, Json>>; total: number; truncated: boolean } {
  const projected: Array<Record<string, Json>> = [];
  let truncated = rows.length > MODEL_ROW_LIMIT;
  for (const item of rows) {
    if (!isRecord(item)) {
      truncated = true;
      continue;
    }
    const row = projectRow(item);
    if (!row) {
      truncated = true;
      continue;
    }
    const state = { truncated: false };
    const bounded = boundValue(row, state) as Record<string, Json>;
    if (state.truncated) truncated = true;
    projected.push(bounded);
  }
  if (projected.length > MODEL_ROW_LIMIT) truncated = true;
  return {
    rows: projected.slice(0, MODEL_ROW_LIMIT),
    total: rows.length,
    truncated,
  };
}

function projectBacklinkSummary(value: Record<string, unknown>): Record<string, Json> {
  return {
    target: pickString(value, "target") ?? "",
    rank: pickNumber(value, "rank") ?? 0,
    backlinks: pickNumber(value, "backlinks") ?? 0,
    referringDomains: pickNumber(value, "referringDomains") ?? 0,
    referringMainDomains: pickNumber(value, "referringMainDomains") ?? 0,
    brokenBacklinks: pickNumber(value, "brokenBacklinks") ?? 0,
    spamScore: pickNumber(value, "spamScore") ?? 0,
    firstSeen: pickString(value, "firstSeen"),
  };
}

function projectReferringDomain(value: Record<string, unknown>): Record<string, Json> | null {
  const domain = pickString(value, "domain");
  if (!domain) return null;
  return {
    domain,
    rank: pickNumber(value, "rank") ?? 0,
    backlinks: pickNumber(value, "backlinks") ?? 0,
    spamScore: pickNumber(value, "spamScore") ?? 0,
    firstSeen: pickString(value, "firstSeen"),
  };
}

function projectAnchor(value: Record<string, unknown>): Record<string, Json> | null {
  const anchor = pickString(value, "anchor");
  if (!anchor) return null;
  return {
    anchor,
    backlinks: pickNumber(value, "backlinks") ?? 0,
    referringDomains: pickNumber(value, "referringDomains") ?? 0,
  };
}

function projectKeyword(value: Record<string, unknown>): Record<string, Json> | null {
  const keyword = pickString(value, "keyword");
  if (!keyword) return null;
  const row: Record<string, Json> = {
    keyword,
    searchVolume: pickNumber(value, "searchVolume") ?? 0,
    cpc: pickNumber(value, "cpc"),
    difficulty: pickNumber(value, "difficulty"),
    intent: pickString(value, "intent"),
  };
  if ("position" in value) row.position = pickNumber(value, "position");
  if ("url" in value) row.url = pickString(value, "url");
  if ("aiSearchVolume" in value) row.aiSearchVolume = pickNumber(value, "aiSearchVolume") ?? 0;
  return row;
}

function projectCompetitor(value: Record<string, unknown>): Record<string, Json> | null {
  const domain = pickString(value, "domain");
  if (!domain) return null;
  return {
    domain,
    avgPosition: pickNumber(value, "avgPosition"),
    intersections: pickNumber(value, "intersections") ?? 0,
  };
}

function projectSerp(value: Record<string, unknown>): Record<string, Json> {
  const state = { truncated: false };
  const organicRaw = Array.isArray(value.organic) ? value.organic : [];
  const organic = listResult(organicRaw, (row) => {
    const domain = pickString(row, "domain");
    const url = pickString(row, "url");
    if (!domain || !url) return null;
    return {
      position: pickNumber(row, "position") ?? 0,
      domain,
      title: pickString(row, "title") ?? "",
      url,
    };
  });
  const askRaw = Array.isArray(value.peopleAlsoAsk) ? value.peopleAlsoAsk : [];
  const peopleAlsoAsk = askRaw
    .map((item) => (typeof item === "string" ? clipString(item) : { value: null as string | null, truncated: true }))
    .flatMap((item) => {
      if (item.truncated) state.truncated = true;
      return item.value ? [item.value] : [];
    });
  if (askRaw.length > MODEL_ROW_LIMIT || organic.truncated) state.truncated = true;
  return {
    organic: organic.rows,
    hasAiOverview: pickBoolean(value, "hasAiOverview") ?? false,
    peopleAlsoAsk: peopleAlsoAsk.slice(0, MODEL_ROW_LIMIT),
    truncated: state.truncated || organic.truncated || peopleAlsoAsk.length < askRaw.length,
  };
}

function projectCitation(value: Record<string, unknown>): Record<string, Json> | null {
  const url = pickString(value, "url");
  if (!url || !isPublicHttpUrl(url)) return null;
  return { title: pickString(value, "title"), url };
}

function projectLlmAnswer(value: Record<string, unknown>): Record<string, Json> | null {
  const engine = asString(value.engine)?.trim() ?? null;
  if (!engine) return null;
  const clipped = clipString(asString(value.text) ?? "");
  const citationsRaw = Array.isArray(value.citations) ? value.citations : [];
  const citations = listResult(citationsRaw, projectCitation);
  return {
    engine: clipString(engine).value,
    model: pickString(value, "model"),
    text: clipped.value,
    citations: citations.rows,
    mentionsBrand: pickBoolean(value, "mentionsBrand") ?? false,
    ...(value.source === "live" || value.source === "cached" ? { source: value.source } : {}),
    ...(clipped.truncated || citations.truncated ? { truncated: true } : {}),
  };
}

function projectLlmResponse(value: unknown): Record<string, Json> | unknown[] | null {
  if (Array.isArray(value)) return listResult(value, projectLlmAnswer);
  if (!isRecord(value)) return null;
  if (Array.isArray(value.answers)) {
    const answers = listResult(value.answers, projectLlmAnswer);
    const truncated = answers.truncated || answers.rows.some((row) => row.truncated === true);
    return truncated ? { answers: answers.rows, truncated: true } : { answers: answers.rows };
  }
  return projectLlmAnswer(value);
}

function projectSearchHit(row: Record<string, unknown>): Record<string, Json> | null {
  const url = pickString(row, "url") ?? pickString(row, "link") ?? pickString(row, "sourceUrl");
  if (!url || !isPublicHttpUrl(url)) return null;
  return {
    title: pickString(row, "title") ?? pickString(row, "name") ?? "",
    url,
    snippet: pickString(row, "snippet") ?? pickString(row, "content") ?? pickString(row, "value") ?? "",
    ...(pickString(row, "sourceLabel") ? { sourceLabel: pickString(row, "sourceLabel") } : {}),
  };
}

function projectInsightPassage(row: Record<string, unknown>): Record<string, Json> | null {
  const id = pickString(row, "id");
  const sourceUrl = pickString(row, "sourceUrl");
  const text = pickString(row, "text");
  const retrievedAt = pickString(row, "retrievedAt");
  if (!id || !sourceUrl || !text || !retrievedAt) return null;
  if (!isPublicHttpUrl(sourceUrl)) return null;
  const limitationsRaw = Array.isArray(row.limitations) ? row.limitations : [];
  const limitations = limitationsRaw
    .map((item) => (typeof item === "string" ? clipString(item, 240).value : null))
    .filter((item): item is string => Boolean(item))
    .slice(0, 8);
  return {
    id,
    sourceUrl,
    text,
    publishedAt: pickString(row, "publishedAt"),
    updatedAt: pickString(row, "updatedAt"),
    retrievedAt,
    limitations,
  };
}

function projectInsights(value: unknown): Json {
  if (Array.isArray(value)) {
    const data = listResult(value, projectInsightPassage);
    return data.truncated ? { passages: data.rows, total: data.total, truncated: true } : { passages: data.rows, total: data.total };
  }
  if (!isRecord(value)) return { unsupported: true };
  const raw = Array.isArray(value.passages) ? value.passages : [];
  const data = listResult(raw, projectInsightPassage);
  const total = typeof value.total === "number" && Number.isFinite(value.total) ? value.total : data.total;
  return {
    passages: data.rows,
    total,
    ...(data.truncated || total > data.rows.length ? { truncated: true } : {}),
  };
}

function projectWebResearch(value: unknown): Json {
  if (Array.isArray(value)) {
    const data = listResult(value, projectSearchHit);
    return data.truncated ? { ...data, truncated: true } : data;
  }
  if (!isRecord(value)) return { unsupported: true };

  if (Array.isArray(value.results) || Array.isArray(value.web_results) || Array.isArray(value.cards)) {
    const web = listResult(
      [
        ...(Array.isArray(value.results) ? value.results : []),
        ...(Array.isArray(value.web_results) ? value.web_results : []),
        ...(Array.isArray(value.cards) ? value.cards : []),
      ],
      projectSearchHit,
    );
    const out: Record<string, Json> = {
      ...(pickString(value, "query") ? { query: pickString(value, "query") } : {}),
      ...(pickString(value, "url") ? { url: pickString(value, "url") } : {}),
      results: web.rows,
      total: web.total,
    };
    if (web.truncated) out.truncated = true;
    return out;
  }

  if (typeof value.markdown === "string" || typeof value.content === "string") {
    const body = asString(value.markdown) ?? asString(value.content) ?? "";
    const clipped = clipString(body);
    return {
      ...(pickString(value, "url") ? { url: pickString(value, "url") } : {}),
      ...(pickString(value, "title") ? { title: pickString(value, "title") } : {}),
      markdown: clipped.value,
      ...(clipped.truncated ? { truncated: true } : {}),
    };
  }

  return { unsupported: true };
}

const jsonLength = (value: unknown): number => JSON.stringify(value).length;

/** The longest prefix of `value` whose JSON string form (quotes and escapes included) fits in `room` characters. */
function clipToJsonLength(value: string, room: number): string {
  if (room < 2) return "";
  if (jsonLength(value) <= room) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (jsonLength(value.slice(0, mid)) <= room) low = mid;
    else high = mid - 1;
  }
  return value.slice(0, low);
}

function boundArray(value: unknown[], limit: number): unknown[] {
  const rows: unknown[] = [];
  const share = Math.floor(limit / Math.max(2, Math.min(value.length, MODEL_ROW_LIMIT)));
  for (const item of value) {
    const sizedItem = boundJsonSize(item, share);
    const candidate = [...rows, sizedItem];
    if (jsonLength(candidate) > limit) break;
    rows.push(sizedItem);
  }
  return rows;
}

function boundRecord(value: Record<string, unknown>, limit: number): Record<string, unknown> {
  const next: Record<string, unknown> = { truncated: true };
  for (const [key, nested] of Object.entries(value)) {
    if (key === "truncated") continue;
    const candidate = { ...next, [key]: nested };
    if (jsonLength(candidate) <= limit) {
      next[key] = nested;
      continue;
    }
    // Room for this value alone: what is left once the key is present with an empty placeholder, plus that placeholder.
    const placeholder = typeof nested === "string" ? "" : Array.isArray(nested) ? [] : isRecord(nested) ? {} : null;
    if (placeholder === null) continue;
    const placeholderLength = jsonLength(placeholder);
    const room = limit - jsonLength({ ...next, [key]: placeholder }) + placeholderLength;
    if (room < placeholderLength) continue;
    const bounded = typeof nested === "string" ? clipToJsonLength(nested, room) : boundJsonSize(nested, room);
    if (jsonLength({ ...next, [key]: bounded }) <= limit) next[key] = bounded;
  }
  return next;
}

/**
 * Shrink arbitrary JSON until it fits a serialized size budget, preserving array/object shape. The result's JSON form
 * is never longer than `limit` (escapes and nesting included); when nothing meaningful fits it is a bare marker or null.
 */
export function boundJsonSize(value: unknown, limit: number): unknown {
  const raw = JSON.stringify(value);
  if (raw === undefined || raw.length <= limit) return value;
  let bounded: unknown;
  if (Array.isArray(value)) bounded = boundArray(value, limit);
  else if (isRecord(value)) bounded = boundRecord(value, limit);
  else if (typeof value === "string") bounded = clipToJsonLength(value, limit);
  else bounded = { truncated: true };
  if (jsonLength(bounded) <= limit) return bounded;
  for (const fallback of [{ truncated: true }, null, ""]) {
    if (jsonLength(fallback) <= limit) return fallback;
  }
  return "";
}

export type ProjectedToolFields =
  | { unsupported: true }
  | { control: true; value: unknown }
  | { data: unknown; truncated: boolean };

function isControlResult(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.error === "string") return true;
  if (value.status === "needs_approval") return true;
  return false;
}

/** Project a tool payload onto the allowlisted fields for that tool. */
export function projectToolFields(tool: string, value: unknown): ProjectedToolFields {
  if (isControlResult(value)) return { control: true, value };

  switch (tool) {
    case "backlink_summary":
      if (!isRecord(value)) return { unsupported: true };
      return { data: projectBacklinkSummary(value), truncated: false };
    case "referring_domains":
    case "backlink_gap":
      if (!Array.isArray(value)) return { unsupported: true };
      return (() => {
        const data = listResult(value, projectReferringDomain);
        return { data, truncated: data.truncated };
      })();
    case "anchors":
      if (!Array.isArray(value)) return { unsupported: true };
      return (() => {
        const data = listResult(value, projectAnchor);
        return { data, truncated: data.truncated };
      })();
    case "keyword_ideas":
    case "keyword_overview":
    case "ranked_keywords":
    case "keyword_gap":
    case "ai_keyword_volume":
      if (!Array.isArray(value)) return { unsupported: true };
      return (() => {
        const data = listResult(value, projectKeyword);
        return { data, truncated: data.truncated };
      })();
    case "competitor_domains":
      if (!Array.isArray(value)) return { unsupported: true };
      return (() => {
        const data = listResult(value, projectCompetitor);
        return { data, truncated: data.truncated };
      })();
    case "google_serp":
      if (!isRecord(value)) return { unsupported: true };
      return (() => {
        const data = projectSerp(value);
        return { data, truncated: data.truncated === true };
      })();
    case "llm_response":
      return (() => {
        const data = projectLlmResponse(value);
        if (data === null) return { unsupported: true as const };
        const truncated = isRecord(data) && data.truncated === true
          || (isRecord(data) && Array.isArray(data.rows) && data.truncated === true)
          || (isRecord(data) && Array.isArray(data.answers) && data.answers.some((row) => isRecord(row) && row.truncated === true));
        return { data, truncated: Boolean(truncated) };
      })();
    case "web_research":
    case "linkup_fetch":
    case "tako_search":
      return (() => {
        const data = projectWebResearch(value);
        if (isRecord(data) && data.unsupported === true) return { unsupported: true as const };
        const truncated = isRecord(data) && data.truncated === true
          || (isRecord(data) && Array.isArray(data.rows) && data.truncated === true);
        return { data, truncated: Boolean(truncated) };
      })();
    case "search_insights":
      return (() => {
        const data = projectInsights(value);
        if (isRecord(data) && data.unsupported === true) return { unsupported: true as const };
        const truncated = isRecord(data) && data.truncated === true;
        return { data, truncated: Boolean(truncated) };
      })();
    default:
      return { unsupported: true };
  }
}

/**
 * What the model may see for one tool result. Control payloads pass through; unknown tools become an error code.
 */
export function filterToolEvidence(tool: string, value: unknown): unknown {
  const projected = projectToolFields(tool, value);
  if ("control" in projected) return projected.value;
  if ("unsupported" in projected) return { error: "unsupported_evidence" };

  let data: unknown = projected.data;
  if (isRecord(projected.data) && "rows" in projected.data && "total" in projected.data) {
    const rows = projected.data.rows;
    const total = projected.data.total;
    if (Array.isArray(rows) && typeof total === "number") {
      const truncated = projected.truncated || total > rows.length || projected.data.truncated === true;
      data = truncated ? { rows, total, truncated: true } : { rows, total };
    }
  } else if (isRecord(projected.data)) {
    if (projected.truncated && projected.data.truncated !== true) data = { ...projected.data, truncated: true };
    else if (projected.data.truncated === false) {
      const rest = { ...projected.data };
      delete rest.truncated;
      data = rest;
    } else {
      data = projected.data;
    }
  }

  return boundJsonSize(data, MODEL_PAYLOAD_JSON_LIMIT);
}
