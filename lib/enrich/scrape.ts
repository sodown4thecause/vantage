import { isPdfUrl } from "@/lib/enrich/url";
import { fetchPublicText } from "@/lib/http/public-fetch";

export type FetchedLink = {
  title: string | null;
  /** Plain markdown text of the page or transcript, capped before summarising. */
  text: string;
};

export type FetchOutcome =
  | { outcome: "ok"; value: FetchedLink }
  /** Paywall, unsupported or unusably large: cache as `skipped`, never retried. */
  | { outcome: "skipped"; reason: string }
  /** Transient failure: cache as `failed`, retried after 24 hours. */
  | { outcome: "failed"; reason: string };

const MAX_FETCH_BYTES = 1_000_000;
/** Cap on page/transcript text handed to the summariser. */
const MAX_TEXT_CHARS = 24_000;
/** Firecrawl's markdown cache lifetime, in milliseconds (7 days, per the plan). */
const FIRECRAWL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** First ~3,000 words of a transcript, as the issue caps it. */
export function capTranscriptWords(text: string, maxWords = 3_000): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function titleFrom(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) return null;
  const title = (meta as Record<string, unknown>)["title"];
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 300) : null;
}

/**
 * YouTube transcript through Supadata (`text=true` for one string). A 202 means
 * the job needs polling, which a scan does not wait for: a transient failure.
 */
export async function fetchYoutubeTranscript(url: string, opts: {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
} = {}): Promise<FetchOutcome> {
  const key = process.env.SUPADATA_API_KEY?.trim();
  if (!key) return { outcome: "failed", reason: "SUPADATA_API_KEY is not set" };
  try {
    const impl = opts.fetchImpl ?? fetch;
    const response = await impl(`https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&text=true`, {
      headers: { "x-api-key": key, accept: "application/json" },
      signal: opts.signal,
      cache: "no-store",
    });
    if (response.status === 202) return { outcome: "failed", reason: "transcript queued; retried later" };
    if (response.status === 403 || response.status === 451) return { outcome: "skipped", reason: `paywall (${response.status})` };
    if (!response.ok) return { outcome: "failed", reason: `supadata ${response.status}` };
    const payload = (await response.json()) as unknown;
    const content = (payload as Record<string, unknown> | null)?.content;
    if (typeof content !== "string" || !content.trim()) return { outcome: "failed", reason: "empty transcript" };
    return { outcome: "ok", value: { title: null, text: capTranscriptWords(content).slice(0, MAX_TEXT_CHARS) } };
  } catch (err) {
    if (opts.signal?.aborted) return { outcome: "failed", reason: "aborted" };
    return { outcome: "failed", reason: err instanceof Error ? err.message : "transcript request failed" };
  }
}

/**
 * A non-YouTube page through Firecrawl v2 /scrape, markdown only, cached by
 * Firecrawl for up to 7 days. reddit.com and x.com never reach this: callers
 * skip those hosts before calling.
 */
export async function fetchLinkedPage(url: string, opts: {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** HEAD probe for a PDF's size; tests inject a stub. */
  headContentLength?: (url: string) => Promise<number | null>;
} = {}): Promise<FetchOutcome> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) return { outcome: "failed", reason: "FIRECRAWL_API_KEY is not set" };
  try {
    if (isPdfUrl(url)) {
      const head = opts.headContentLength ?? defaultHeadLength;
      const bytes = await head(url);
      if (bytes !== null && bytes > 5_000_000) return { outcome: "skipped", reason: "pdf over 5 MB" };
    }
    const impl = opts.fetchImpl ?? fetch;
    const response = await impl("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, maxAge: FIRECRAWL_MAX_AGE_MS }),
      signal: opts.signal,
      cache: "no-store",
    });
    if (response.status === 403 || response.status === 451) return { outcome: "skipped", reason: `paywall (${response.status})` };
    if (!response.ok) return { outcome: "failed", reason: `firecrawl ${response.status}` };
    const payload = (await response.json()) as unknown;
    const data = (payload as Record<string, unknown> | null)?.data;
    if (typeof data !== "object" || data === null) return { outcome: "failed", reason: "invalid firecrawl response" };
    const record = data as Record<string, unknown>;
    if (record.success === false) return { outcome: "failed", reason: "firecrawl reported failure" };
    const markdown = typeof record.markdown === "string" ? record.markdown.trim() : "";
    if (!markdown) return { outcome: "skipped", reason: "no readable content" };
    return { outcome: "ok", value: { title: titleFrom(record.metadata), text: markdown.slice(0, MAX_TEXT_CHARS) } };
  } catch (err) {
    if (opts.signal?.aborted) return { outcome: "failed", reason: "aborted" };
    return { outcome: "failed", reason: err instanceof Error ? err.message : "scrape request failed" };
  }
}

async function defaultHeadLength(url: string): Promise<number | null> {
  try {
    const { response } = await fetchPublicText(url, { method: "HEAD" });
    const length = response.headers.get("content-length");
    const n = length === null ? null : Number(length);
    return n !== null && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
