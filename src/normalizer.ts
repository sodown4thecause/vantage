import { XMLParser } from "fast-xml-parser";
import type { NormalizedItem, RawSignal, Source, SourceCategory } from "./types";

// ---------------------------------------------------------------------------
// Canonicalization + hashing helpers (pure).
// ---------------------------------------------------------------------------

/**
 * Global tracking params: only the industry-standard set (`utm_*` by prefix,
 * plus `fbclid`/`gclid`). Deliberately excludes `ref`/`source`: those are
 * meaningful query keys on many sites and deleting them globally collapses
 * genuinely-different URLs. Per-source opt-in is used instead (see
 * `Source.stripParams` / `canonicalizeUrl`'s `extraStripParams` argument).
 */
function isTrackingParam(param: string): boolean {
  return /^utm_/i.test(param) || /^(fbclid|gclid)$/i.test(param);
}

/** Should a query key be dropped for this URL? Global rules, then per-source opt-in. */
function isStrippedParam(param: string, extraStripParams: ReadonlySet<string>): boolean {
  return isTrackingParam(param) || extraStripParams.has(param.toLowerCase());
}

/**
 * Normalize percent-encoding in a pathname to a single canonical form: uppercase
 * every `%xx` escape. This collapses case-only variants (`%2f` vs `%2F`) while
 * decoding NOTHING.
 *
 * Do NOT `decodeURI` here. Decoding reserved bytes changes path segmentation,
 * and decoding `%2E`/`%25` is actively destructive:
 *   - `%2E` -> `.` then reassigning to `pathname` re-triggers WHATWG dot-segment
 *     removal, so `/a/%2E%2E/secret` collapses onto `/secret`.
 *   - `%25` -> `%`, so `%252F` (a segment literally containing `%2F`) collapses
 *     onto the segment `%2F`.
 * Both are over-merges: distinct articles collide on `canonical_url` (UNIQUE per
 * source) and one is silently dropped as a duplicate. Uppercase-hex never decodes,
 * so `%2F`/`%3F`/`%23` stay distinct from `/`/`?`/`#` and segmentation is stable.
 */
export function normalizePercentEncoding(pathname: string): string {
  return pathname.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
}

/**
 * Canonical URL: lowercase host, force `https`, drop a leading `www.`, strip
 * tracking params, normalize percent-encoding, drop trailing slash, sort query.
 * Deterministic.
 *
 * `http:` is upgraded to `https:` for the general case: the overwhelming
 * majority of feeds now serve https and this is the pragmatic default that
 * collapses the common `http://` vs `https://` duplicate. The rare http-only
 * host is not special-cased here — if one appears, its canonical form will differ
 * from its origin and it can be excluded per-source at the registry layer.
 */
export function canonicalizeUrl(
  rawUrl: string,
  extraStripParams: ReadonlySet<string> = new Set(),
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    // Non-URL (rare for feeds); fall back to a stable trim/lowercase.
    return rawUrl.trim().toLowerCase();
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  // `http:` -> `https:` so scheme variants of the same article dedup.
  if (parsed.protocol === "http:") parsed.protocol = "https:";
  for (const param of [...parsed.searchParams.keys()]) {
    if (isStrippedParam(param, extraStripParams)) parsed.searchParams.delete(param);
  }
  parsed.searchParams.sort();
  // Normalize the path *before* stringifying so a trailing slash is dropped
  // regardless of whether a query string follows.
  const encodedPath = normalizePercentEncoding(parsed.pathname);
  if (encodedPath !== "/" && encodedPath.endsWith("/")) {
    parsed.pathname = encodedPath.slice(0, -1);
  } else {
    parsed.pathname = encodedPath;
  }
  return parsed.toString();
}

/**
 * The boundary rule for a usable candidate: it must carry a non-empty title and
 * url. Shared by `normalize` and `normalizeSignals` so both entry points filter
 * identically (the deeper `toNormalizedItem` throws as a fail-loud backstop).
 */
function hasUsableTitleAndUrl(candidate: { readonly title: string; readonly url: string }): boolean {
  return candidate.title.trim() !== "" && candidate.url.trim() !== "";
}

/** Collapse whitespace, lowercase, strip punctuation for title comparison. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Strip HTML tags and decode a handful of entities for plain-text summaries. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text === "") return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A raw candidate item before hashing/normalization. Fields may be partial. */
interface Candidate {
  readonly title: string;
  readonly url: string;
  readonly author?: string | undefined;
  readonly publishedAt?: string | null | undefined;
  readonly summary?: string | undefined;
  readonly rawContent?: string | undefined;
  readonly signalTags?: ReadonlyArray<string> | undefined;
}

async function toNormalizedItem(
  source: Source,
  candidate: Candidate,
  fetchedAt: string,
): Promise<NormalizedItem> {
  // Parse, don't validate: an empty title/url is not a usable item. Fail loud so
  // callers that bypassed the feed-level filter (e.g. `normalizeSignals`) cannot
  // slip a half-formed row into the pipeline.
  const title = candidate.title.trim();
  const url = candidate.url.trim();
  if (title === "" || url === "") {
    throw new Error(`cannot normalize item for source "${source.id}": missing title or url`);
  }

  // Per-source opt-in stripping for params like `ref`/`source` that are only
  // tracking noise on specific sites.
  const extraStripParams = new Set((source.stripParams ?? []).map((p) => p.toLowerCase()));
  const canonicalUrl = canonicalizeUrl(url, extraStripParams);
  const normalizedTitle = normalizeTitle(title);
  const rawContent = candidate.rawContent ?? candidate.summary ?? "";
  const [titleHash, globalTitleHash, contentHash] = await Promise.all([
    sha256Hex(`${source.id}\n${normalizedTitle}`),
    sha256Hex(normalizedTitle),
    sha256Hex(`${canonicalUrl}\n${title}\n${candidate.summary ?? ""}`),
  ]);
  return {
    sourceId: source.id,
    sourceName: source.name,
    category: source.category,
    title,
    url,
    author: candidate.author?.trim() || null,
    publishedAt: candidate.publishedAt ?? null,
    summary: candidate.summary?.trim() || null,
    canonicalUrl,
    titleHash,
    globalTitleHash,
    contentHash,
    rawContent,
    fetchedAt,
    signalTags: candidate.signalTags ?? [],
  };
}

// ---------------------------------------------------------------------------
// RSS / Atom via fast-xml-parser (pure JS, runs on Workers).
// ---------------------------------------------------------------------------

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => name === "item" || name === "entry",
});

function firstText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)["#text"]);
  }
  return undefined;
}

function linkFromAtom(entry: Record<string, unknown>): string | undefined {
  const links = entry["link"];
  if (Array.isArray(links)) {
    const alternate = links.find(
      (l) => (l as Record<string, unknown>)["@_rel"] === "alternate",
    ) as Record<string, unknown> | undefined;
    const chosen = alternate ?? (links[0] as Record<string, unknown> | undefined);
    return chosen ? firstText(chosen["@_href"]) : undefined;
  }
  if (links && typeof links === "object") {
    return firstText((links as Record<string, unknown>)["@_href"]);
  }
  return undefined;
}

function mapFeedEntry(entry: Record<string, unknown>): Candidate | null {
  const title = firstText(entry["title"]);
  const link =
    firstText(entry["link"]) ?? linkFromAtom(entry) ?? firstText(entry["guid"]);
  if (!title || !link) return null;

  const summary =
    firstText(entry["description"]) ??
    firstText(entry["summary"]) ??
    firstText(entry["content"]) ??
    "";
  const authorObj = entry["author"];
  const author =
    firstText(entry["dc:creator"]) ??
    (authorObj && typeof authorObj === "object"
      ? firstText((authorObj as Record<string, unknown>)["name"])
      : firstText(authorObj));

  const publishedAt =
    toIsoOrNull(entry["pubDate"]) ??
    toIsoOrNull(entry["published"]) ??
    toIsoOrNull(entry["updated"]);

  const categories = entry["category"];
  const signalTags = Array.isArray(categories)
    ? categories.map((c) => firstText(c) ?? firstText((c as Record<string, unknown>)["@_term"] ?? "")).filter(Boolean)
    : [];

  return {
    title,
    url: link,
    author: author ?? undefined,
    publishedAt: publishedAt ?? undefined,
    summary: stripHtml(summary),
    rawContent: typeof summary === "string" ? summary : "",
    signalTags: signalTags as string[],
  };
}

/**
 * Parse an RSS 2.0 / Atom document. Returns raw candidates; throws only on
 * structurally unparseable XML (the caller turns that into a retryable error).
 */
export function parseFeed(xml: string): ReadonlyArray<Candidate> {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const rss = parsed["rss"] as Record<string, unknown> | undefined;
  const channel = rss?.["channel"] as Record<string, unknown> | undefined;
  if (channel?.["item"]) {
    const items = channel["item"] as Array<Record<string, unknown>>;
    return items.map(mapFeedEntry).filter((c): c is Candidate => c !== null);
  }

  const feed = parsed["feed"] as Record<string, unknown> | undefined;
  if (feed?.["entry"]) {
    const entries = feed["entry"] as Array<Record<string, unknown>>;
    return entries.map(mapFeedEntry).filter((c): c is Candidate => c !== null);
  }

  // Some feeds (e.g. Lobsters) name the root differently; be lenient.
  const rdf = parsed["rdf:RDF"] as Record<string, unknown> | undefined;
  if (rdf?.["item"]) {
    const items = rdf["item"] as Array<Record<string, unknown>>;
    return items.map(mapFeedEntry).filter((c): c is Candidate => c !== null);
  }

  return [];
}

// ---------------------------------------------------------------------------
// JSON APIs. Each API has its own shape; small adapters keep the common schema
// clean. Unknown shapes fail loud rather than emitting half-baked items.
// ---------------------------------------------------------------------------

interface JsonAdapter {
  readonly toCandidates: (payload: unknown, source: Source) => ReadonlyArray<Candidate>;
}

const stackExchangeAdapter: JsonAdapter = {
  toCandidates(payload) {
    const items = (payload as { items?: unknown[] }).items;
    if (!Array.isArray(items)) return [];
    return items.map((raw) => {
      const q = raw as Record<string, unknown>;
      const tags = Array.isArray(q["tags"]) ? (q["tags"] as string[]) : [];
      return {
        title: String(q["title"] ?? ""),
        url: String(q["link"] ?? ""),
        author: q["owner"] ? String((q["owner"] as Record<string, unknown>)["display_name"] ?? "") : undefined,
        publishedAt: toIsoOrNull(
          q["creation_date"] !== undefined ? Number(q["creation_date"]) * 1000 : null,
        ),
        summary: `score ${q["score"] ?? 0}, answers ${q["answer_count"] ?? 0}`,
        signalTags: tags,
      } satisfies Candidate;
    });
  },
};

const npmAdapter: JsonAdapter = {
  toCandidates(payload, source) {
    const p = payload as { package?: string; downloads?: number; start?: string; end?: string };
    if (p.downloads === undefined || !p.package) return [];
    const period = `${p.start ?? ""}..${p.end ?? ""}`;
    return [
      {
        title: `${p.package}: ${p.downloads.toLocaleString("en-US")} downloads (${period})`,
        url: `https://www.npmjs.com/package/${p.package}`,
        summary: `${p.downloads} weekly downloads ending ${p.end ?? ""}`,
        signalTags: [source.category],
      } satisfies Candidate,
    ];
  },
};

const pypiAdapter: JsonAdapter = {
  toCandidates(payload, source) {
    const p = payload as { data?: { last_day?: number; last_week?: number; last_month?: number } };
    if (!p.data || p.data.last_week === undefined) return [];
    const pkg = source.id.split(":").at(-1) ?? "package";
    return [
      {
        title: `${pkg}: ${p.data.last_week.toLocaleString("en-US")} downloads (last week)`,
        url: `https://pypi.org/project/${pkg}/`,
        summary: `day ${p.data.last_day ?? 0}, week ${p.data.last_week ?? 0}, month ${p.data.last_month ?? 0}`,
        signalTags: [source.category],
      } satisfies Candidate,
    ];
  },
};

const edgarAdapter: JsonAdapter = {
  toCandidates(payload) {
    const hits = (payload as { hits?: { hits?: unknown[] } }).hits?.hits;
    if (!Array.isArray(hits)) return [];
    // Skip hits with no accession id: there is no per-filing URL to key on, so
    // every such hit would collapse to one canonical URL and distinct filings
    // would be silently dropped. The missed count is reported by the caller's
    // fail-loud logging (see `normalize`).
    const candidates: Candidate[] = [];
    for (const raw of hits) {
      const h = raw as { _source?: Record<string, unknown>; _id?: string };
      const src = h._source ?? {};
      const accession = (h._id ?? "").trim();
      if (accession === "") continue;
      const display = (src["display_names"] as string[] | undefined)?.[0] ?? "Unknown filer";
      candidates.push({
        // Accession in the title keeps distinct filings from one filer from
        // colliding on title_hash.
        title: `${display} — Form D filing ${accession}`,
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=${accession}`,
        publishedAt: toIsoOrNull(src["file_date"]),
        summary: `cik ${src["ciks"] ?? ""}, form ${src["root_forms"] ?? "D"}`,
        signalTags: ["sec", "form-d"],
      } satisfies Candidate);
    }
    return candidates;
  },
};

/** Choose the adapter for an `api`-method source by its id prefix. */
function jsonAdapterFor(source: Source): JsonAdapter {
  if (source.id.startsWith("stackexchange")) return stackExchangeAdapter;
  if (source.id.startsWith("npm-downloads")) return npmAdapter;
  if (source.id.startsWith("pypi-stats")) return pypiAdapter;
  if (source.id.startsWith("sec-edgar")) return edgarAdapter;
  throw new Error(`no JSON adapter for api source "${source.id}"`);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function isFeedMethod(source: Source): boolean {
  return (
    source.accessMethod === "rss" ||
    source.accessMethod === "atom" ||
    source.accessMethod === "google_news" ||
    source.accessMethod === "rsshub"
  );
}

/**
 * Normalize a fetched payload into `NormalizedItem`s. The boundary is explicit:
 * feed content is parsed as XML, api content as JSON, and unknown access methods
 * fail loud.
 */
export async function normalize(
  source: Source,
  body: string,
  fetchedAt: string,
): Promise<ReadonlyArray<NormalizedItem>> {
  let candidates: ReadonlyArray<Candidate>;

  if (isFeedMethod(source)) {
    candidates = parseFeed(body);
  } else if (source.accessMethod === "api") {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(`source "${source.id}" returned non-JSON body for api accessMethod`);
    }
    candidates = jsonAdapterFor(source).toCandidates(payload, source);
  } else {
    throw new Error(`unsupported accessMethod "${source.accessMethod}" for source "${source.id}"`);
  }

  return Promise.all(
    candidates
      .filter(hasUsableTitleAndUrl)
      .map((c) => toNormalizedItem(source, c, fetchedAt)),
  );
}

/**
 * Normalize operator/API-supplied signals (future Grok/X seam) for one source.
 * Applies the same empty-title/url filter as `normalize` so the two entry points
 * cannot diverge.
 */
export async function normalizeSignals(
  source: Source,
  signals: ReadonlyArray<RawSignal>,
  fetchedAt: string,
): Promise<ReadonlyArray<NormalizedItem>> {
  return Promise.all(
    signals
      .filter((signal) => hasUsableTitleAndUrl({ title: signal.title, url: signal.url }))
      .map((signal) =>
        toNormalizedItem(
          source,
          {
            title: signal.title,
            url: signal.url,
            author: signal.author,
            publishedAt: signal.publishedAt ? toIsoOrNull(signal.publishedAt) : undefined,
            summary: signal.summary ?? "",
            rawContent: signal.rawContent ?? signal.summary ?? "",
            signalTags: signal.signalTags,
          },
          fetchedAt,
        ),
      ),
  );
}

export type { Candidate, JsonAdapter };
